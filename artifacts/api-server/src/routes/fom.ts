import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  integrationImportsTable,
  integrationSettingsTable,
} from "@workspace/db";
import {
  GetFomStatusResponse,
  SaveFomSettingsBody,
  SyncFomResponse,
  TestFomConnectionResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";
import { auditLogTable } from "@workspace/db";

const router: IRouter = Router();
const BASE_URL_KEY = "fom_base_url";
const adapterWaitingMessage =
  "FOM API endpoint va ma’lumot formati berilmagan. Ulanish sinovi va import shu ma’lumotlar aniqlanguncha kutilmoqda.";

async function readStatus() {
  const [baseUrlRow] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.key, BASE_URL_KEY))
    .limit(1);
  const [lastImport] = await db
    .select()
    .from(integrationImportsTable)
    .where(eq(integrationImportsTable.integration, "fom"))
    .orderBy(desc(integrationImportsTable.startedAt))
    .limit(1);
  const baseUrl = baseUrlRow?.value ?? null;
  const keyConfigured = Boolean(process.env.FOM_API_KEY);
  return GetFomStatusResponse.parse({
    connected: false,
    configured: Boolean(baseUrl && keyConfigured),
    baseUrl,
    keyConfigured,
    lastSyncAt: lastImport?.completedAt ?? lastImport?.startedAt ?? null,
    lastSyncStatus: lastImport?.status ?? (baseUrl ? "waiting" : "not_started"),
    lastMessage:
      lastImport?.message ||
      (baseUrl || keyConfigured ? adapterWaitingMessage : null),
    importedRecords: lastImport?.importedRecords ?? 0,
  });
}

router.get("/fom/status", async (_req, res): Promise<void> => {
  res.json(await readStatus());
});

router.put(
  "/fom/settings",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    const parsed = SaveFomSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    let url: URL;
    try {
      url = new URL(parsed.data.baseUrl);
    } catch {
      res.status(400).json({ error: "API manzili noto‘g‘ri." });
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".local")
    ) {
      res.status(400).json({
        error: "Xavfsizlik uchun ochiq FOM manzili HTTPS bo‘lishi va login ma’lumotlarini o‘z ichiga olmasligi kerak.",
      });
      return;
    }

    await db
      .insert(integrationSettingsTable)
      .values({ key: BASE_URL_KEY, value: url.toString() })
      .onConflictDoUpdate({
        target: integrationSettingsTable.key,
        set: { value: url.toString(), updatedAt: new Date() },
      });
    await db.insert(auditLogTable).values({
      actorId: String(res.locals.userId),
      action: "fom.settings.updated",
      entityType: "integration",
      entityId: "fom",
      summary: "FOM API manzili yangilandi",
    });
    res.json(await readStatus());
  },
);

router.post(
  "/fom/test",
  requireRole("admin", "finance"),
  async (_req, res): Promise<void> => {
    const status = await readStatus();
    res.json(
      TestFomConnectionResponse.parse({
        status: "waiting",
        message: status.configured
          ? adapterWaitingMessage
          : "Avval FOM API manzili va serverdagi maxfiy kalitni sozlang.",
        checkedAt: new Date(),
      }),
    );
  },
);

router.post(
  "/fom/sync",
  requireRole("admin", "finance"),
  async (_req, res): Promise<void> => {
    const status = await readStatus();
    const message = status.configured
      ? adapterWaitingMessage
      : "API manzili yoki serverdagi maxfiy kalit yetishmayapti. Import boshlanmadi.";
    const [importRow] = await db
      .insert(integrationImportsTable)
      .values({
        status: "waiting",
        completedAt: new Date(),
        importedRecords: 0,
        message,
      })
      .returning();
    res.json(
      SyncFomResponse.parse({
        status: "waiting",
        message: importRow.message,
        checkedAt: importRow.completedAt,
      }),
    );
  },
);

export default router;
