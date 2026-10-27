import { timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, isNotNull, ne } from "drizzle-orm";
import express, { Router, type IRouter, type Request } from "express";
import {
  auditLogTable,
  branchesTable,
  counterpartiesTable,
  db,
  integrationImportsTable,
  integrationSettingsTable,
  inventoryBalancesTable,
  productsTable,
  purchasesTable,
  salesTable,
  stockDocumentsTable,
} from "@workspace/db";
import {
  GetFomSettingsResponse,
  GetFomStatusResponse,
  SaveFomSettingsBody,
  SyncFomBody,
  SyncFomResponse,
  TestFomConnectionResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";
import {
  FOM_REPORTS,
  decodeXml,
  fomConfig,
  fomSavedConfig,
  parseFilialIds,
  parseFomXml,
  type FomReportKey,
} from "../lib/fomClient";
import { saveFomSettings } from "../lib/fomSettings";
import {
  fomSyncRunning,
  importAgentReport,
  importSitePush,
  startFomSync,
  testFomConnection,
  type SyncDetails,
} from "../lib/fomSync";

const router: IRouter = Router();
const LAST_TEST_KEY = "fom_last_test";
const reportAvailable = !process.env.VERCEL;
const REPORT_UNAVAILABLE =
  "REPORT.exe Radmin VPN ichida: unga Vercel serveridan ulanib boʻlmaydi. Bu saytda maʼlumot SITE.exe orqali keladi.";

async function latestImport(integration: string, statusFilter?: string) {
  const [row] = await db
    .select()
    .from(integrationImportsTable)
    .where(
      and(
        eq(integrationImportsTable.integration, integration),
        statusFilter ? eq(integrationImportsTable.status, statusFilter) : undefined,
      ),
    )
    .orderBy(desc(integrationImportsTable.startedAt))
    .limit(1);
  return row;
}

function parseDetails(raw: string | undefined): SyncDetails | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncDetails;
  } catch {
    return null;
  }
}

async function countWhere(query: Promise<Array<{ value: number }>>) {
  const [row] = await query;
  return Number(row?.value ?? 0);
}

async function readStatus() {
  const config = fomConfig();
  const [lastImport, siteImport, agentImport, lastTestRow] = await Promise.all([
    latestImport("fom"),
    latestImport("fom-site"),
    latestImport("fom-agent"),
    db
      .select()
      .from(integrationSettingsTable)
      .where(eq(integrationSettingsTable.key, LAST_TEST_KEY))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  if (lastImport?.status === "running" && !fomSyncRunning()) {
    lastImport.status = "error";
    lastImport.message = "Sinxronlash yakunlanmadi (server qayta ishga tushgan). Qayta boshlang.";
  }
  const details = parseDetails(lastImport?.details);
  const lastTest = (() => {
    try {
      return lastTestRow ? (JSON.parse(lastTestRow.value) as { ok: boolean; at: string }) : null;
    } catch {
      return null;
    }
  })();

  const syncAt = lastImport?.completedAt ?? lastImport?.startedAt ?? null;
  const syncOk = lastImport
    ? lastImport.status === "success" ||
      (lastImport.status === "running" && Object.values(details?.reports ?? {}).some((r) => r && !r.error))
    : null;
  const siteAt = siteImport?.completedAt ?? siteImport?.startedAt ?? null;
  const agentAt = agentImport?.completedAt ?? agentImport?.startedAt ?? null;
  const sitePushing =
    siteImport?.status === "success" && !!siteAt && Date.now() - siteAt.getTime() < 30 * 60_000;
  const agentPushing =
    agentImport?.status === "success" && !!agentAt && Date.now() - agentAt.getTime() < 30 * 60_000;
  // Vercelda REPORT.exe ga ulanib bo'lmaydi — SITE.exe YOKI PHARMEX Agent orqali keladi
  const connected = !reportAvailable
    ? sitePushing || agentPushing
    : lastTest && (!syncAt || new Date(lastTest.at) > syncAt) ? lastTest.ok : Boolean(syncOk);

  const inboundAt = [siteAt, agentAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
  const inboundImport =
    inboundAt && agentAt && inboundAt.getTime() === agentAt.getTime()
      ? agentImport
      : inboundAt && siteAt && inboundAt.getTime() === siteAt.getTime()
        ? siteImport
        : siteImport ?? agentImport;
  const inboundVia = inboundImport?.integration === "fom-agent" ? "agent" : inboundImport ? "site" : null;

  const [branches, products, counterparties, stockLines, purchases, sales, stockDocuments] =
    await Promise.all([
      countWhere(db.select({ value: count() }).from(branchesTable).where(eq(branchesTable.source, "fom"))),
      countWhere(db.select({ value: count() }).from(productsTable).where(eq(productsTable.source, "fom"))),
      countWhere(db.select({ value: count() }).from(counterpartiesTable).where(isNotNull(counterpartiesTable.fomId))),
      countWhere(
        db
          .select({ value: count() })
          .from(inventoryBalancesTable)
          .where(and(eq(inventoryBalancesTable.source, "fom"), ne(inventoryBalancesTable.quantity, "0"))),
      ),
      countWhere(db.select({ value: count() }).from(purchasesTable).where(eq(purchasesTable.source, "fom"))),
      countWhere(db.select({ value: count() }).from(salesTable).where(eq(salesTable.source, "fom"))),
      countWhere(db.select({ value: count() }).from(stockDocumentsTable).where(eq(stockDocumentsTable.source, "fom"))),
    ]);

  const token = config.siteToken;
  return GetFomStatusResponse.parse({
    connected,
    configured: Boolean(config.reportUrl),
    baseUrl: config.reportUrl,
    keyConfigured: Boolean(token),
    lastSyncAt: syncAt,
    lastSyncStatus: lastImport?.status ?? "not_started",
    lastMessage: lastImport?.message || (config.reportUrl ? null : "FOM server manzili sozlanmagan (Sozlamalar → FOM ulanishi)."),
    importedRecords: lastImport?.importedRecords ?? 0,
    running: fomSyncRunning(),
    reportAvailable,
    filialIds: details?.filials?.length ? details.filials : config.filialIds,
    intervalMinutes: config.intervalMinutes,
    refsIntervalMinutes: config.refsIntervalMinutes,
    refsAt: details?.refsAt ?? null,
    lastSyncFrom: details?.from ?? null,
    lastSyncTo: details?.to ?? null,
    reports: Object.values(FOM_REPORTS).map((report) => {
      const outcome = details?.reports?.[report.key as keyof SyncDetails["reports"]];
      return {
        key: report.key,
        reportId: report.id,
        label: report.label,
        target: report.target,
        dated: report.dated,
        rows: outcome?.rows ?? null,
        imported: outcome?.imported ?? null,
        error: outcome?.error ?? null,
        warning: outcome?.warning ?? null,
      };
    }),
    site: {
      configured: Boolean(token),
      path: token ? `/api/fom/site/${token.slice(0, 4)}…${token.slice(-4)}` : null,
      lastAt: inboundAt,
      lastStatus: inboundImport?.status ?? null,
      lastMessage: inboundImport
        ? `${inboundVia === "agent" ? "Agent" : "SITE.exe"}: ${inboundImport.message ?? ""}`.trim()
        : null,
      lastRecords: inboundImport?.importedRecords ?? 0,
    },
    totals: { branches, products, counterparties, stockLines, purchases, sales, stockDocuments },
  });
}

router.get("/fom/status", async (_req, res): Promise<void> => {
  res.json(await readStatus());
});

function settingsView(updatedAt: Date | null) {
  const config = fomConfig();
  const saved = fomSavedConfig();
  let protocol: "http" | "https" = "http";
  let host = "";
  let port: number | null = null;
  if (config.reportUrl) {
    try {
      const url = new URL(config.reportUrl);
      protocol = url.protocol === "https:" ? "https" : "http";
      host = url.hostname;
      port = url.port ? Number(url.port) : null;
    } catch {
      host = config.reportUrl;
    }
  }
  const token = config.apiToken;
  return GetFomSettingsResponse.parse({
    source: saved ? "saved" : config.reportUrl ? "env" : "none",
    protocol,
    host,
    port,
    reportUrl: config.reportUrl,
    filialIds: config.filialIds,
    intervalMinutes: config.intervalMinutes,
    initialDays: config.initialDays,
    timeoutSeconds: Math.round(config.timeoutMs / 1000),
    apiTokenSet: Boolean(token),
    apiTokenHint: token ? (token.length > 8 ? `${token.slice(0, 2)}…${token.slice(-2)}` : "••••") : null,
    updatedAt,
  });
}

async function settingsUpdatedAt(): Promise<Date | null> {
  const [row] = await db
    .select({ updatedAt: integrationSettingsTable.updatedAt })
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.key, "fom_config"))
    .limit(1);
  return row?.updatedAt ?? null;
}

router.get("/fom/settings", requireRole("admin", "finance"), async (_req, res): Promise<void> => {
  res.json(settingsView(await settingsUpdatedAt()));
});

const HOST_PATTERN = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

router.put("/fom/settings", requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = SaveFomSettingsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const host = input.host.trim();
  if (!HOST_PATTERN.test(host)) {
    res.status(400).json({ error: "Server manzili notoʻgʻri. Faqat IP yoki domen kiriting (masalan 26.66.205.88)." });
    return;
  }
  const filialIds = parseFilialIds(input.filialIds);
  if (filialIds.some((id) => !/^\d+$/.test(id))) {
    res.status(400).json({ error: "Filial ID lari faqat raqamlardan iborat boʻlishi kerak (masalan: 1, 2, 3)." });
    return;
  }
  const apiToken = input.clearApiToken ? null : input.apiToken?.trim() || fomConfig().apiToken;
  await saveFomSettings({
    reportUrl: `${input.protocol}://${host}${input.port ? `:${input.port}` : ""}`,
    filialIds,
    intervalMinutes: input.intervalMinutes,
    initialDays: input.initialDays,
    timeoutMs: input.timeoutSeconds * 1000,
    apiToken,
  });
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "fom.settings.saved",
    entityType: "integration",
    entityId: "fom",
    summary: `REPORT.exe: ${host}${input.port ? `:${input.port}` : ""}, filiallar: ${filialIds.join(", ") || "avtomatik"}`,
  });
  res.json(settingsView(await settingsUpdatedAt()));
});

router.post(
  "/fom/test",
  requireRole("admin", "finance"),
  async (_req, res): Promise<void> => {
    if (!reportAvailable) {
      res.json(TestFomConnectionResponse.parse({ status: "error", message: REPORT_UNAVAILABLE, checkedAt: new Date() }));
      return;
    }
    const result = await testFomConnection();
    const value = JSON.stringify({ ok: result.ok, at: new Date().toISOString() });
    await db
      .insert(integrationSettingsTable)
      .values({ key: LAST_TEST_KEY, value })
      .onConflictDoUpdate({ target: integrationSettingsTable.key, set: { value, updatedAt: new Date() } });
    res.json(
      TestFomConnectionResponse.parse({
        status: result.ok ? "success" : "error",
        message: result.message,
        checkedAt: new Date(),
      }),
    );
  },
);

router.post(
  "/fom/sync",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    if (!reportAvailable) {
      res.json(SyncFomResponse.parse({ status: "error", message: REPORT_UNAVAILABLE, checkedAt: new Date() }));
      return;
    }
    const parsed = SyncFomBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { dateFrom, dateTo } = parsed.data;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      res.status(400).json({ error: "Boshlanish sanasi tugash sanasidan keyin boʻlishi mumkin emas." });
      return;
    }
    const result = await startFomSync({
      from: dateFrom ? new Date(dateFrom) : undefined,
      to: dateTo ? new Date(dateTo) : undefined,
      trigger: "manual",
    });
    if (result.started) {
      await db.insert(auditLogTable).values({
        actorId: String(res.locals.userId),
        action: "fom.sync.started",
        entityType: "integration",
        entityId: "fom",
        summary: result.message,
      });
    }
    res.json(
      SyncFomResponse.parse({
        status: result.started ? "running" : fomSyncRunning() ? "running" : "error",
        message: result.message,
        checkedAt: new Date(),
      }),
    );
  },
);

export default router;

// ---------------------------------------------------------------- SITE.exe (public, token protected)

export const fomSiteRouter: IRouter = Router();

function tokenFrom(req: Request): string {
  const header = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body = req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
    ? (req.body as Record<string, unknown>)
    : {};
  const candidates = [
    req.params.token,
    req.query.token,
    req.query.tocing,
    req.query.TOCING,
    req.get("x-token"),
    req.get("tocing"),
    header,
    body.token,
    body.tocing,
    body.TOCING,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof found === "string" ? found.trim() : "";
}

function sameToken(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function xmlFrom(req: Request): string {
  const body: unknown = req.body;
  if (Buffer.isBuffer(body)) return decodeXml(new Uint8Array(body), req.get("content-type"));
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const value = Object.values(body as Record<string, unknown>).find(
      (item) => typeof item === "string" && item.includes("<"),
    );
    if (typeof value === "string") return value;
  }
  return "";
}

fomSiteRouter.post(
  ["/fom/site", "/fom/site/:token"],
  express.raw({ type: () => true, limit: "200mb" }),
  async (req, res): Promise<void> => {
    const expected = fomConfig().siteToken;
    if (!expected) {
      res.status(503).type("text/plain").send("SITE token is not configured");
      return;
    }
    if (!sameToken(tokenFrom(req), expected)) {
      res.status(401).type("text/plain").send("Invalid token");
      return;
    }
    const startedAt = new Date();
    try {
      const xml = xmlFrom(req);
      const rows = parseFomXml(xml);
      if (rows.length === 0) throw new Error("XML ichida <V .../> qatorlari topilmadi.");
      const result = await importSitePush(rows);
      await db.insert(integrationImportsTable).values({
        integration: "fom-site",
        status: "success",
        startedAt,
        completedAt: new Date(),
        importedRecords: result.batches,
        message: `SITE.exe: ${result.batches} qoldiq qatori, ${result.products} tovar qabul qilindi.`,
      });
      res.type("text/plain").send("OK");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.insert(integrationImportsTable).values({
        integration: "fom-site",
        status: "error",
        startedAt,
        completedAt: new Date(),
        message: `SITE.exe: ${message}`.slice(0, 500),
      });
      res.status(400).type("text/plain").send(message);
    }
  },
);

// ---------------------------------------------------------------- On-prem Windows agent (pulls REPORT.exe locally, pushes here)

const AGENT_REPORTS = new Set(Object.keys(FOM_REPORTS));

fomSiteRouter.get(["/fom/agent/ping", "/fom/agent/:token/ping"], async (req, res): Promise<void> => {
  const expected = fomConfig().siteToken;
  if (!expected) {
    res.status(503).json({ ok: false, error: "Agent token sozlanmagan (FOM_SITE_TOKEN)." });
    return;
  }
  if (!sameToken(tokenFrom(req), expected)) {
    res.status(401).json({ ok: false, error: "Invalid token" });
    return;
  }
  res.json({
    ok: true,
    reports: Object.values(FOM_REPORTS).map((r) => ({ key: r.key, id: r.id, dated: r.dated, label: r.label })),
  });
});

fomSiteRouter.post(
  ["/fom/agent/report", "/fom/agent/:token/report"],
  express.json({ limit: "4.5mb" }),
  async (req, res): Promise<void> => {
    const expected = fomConfig().siteToken;
    if (!expected) {
      res.status(503).json({ ok: false, error: "Agent token sozlanmagan (FOM_SITE_TOKEN)." });
      return;
    }
    if (!sameToken(tokenFrom(req), expected)) {
      res.status(401).json({ ok: false, error: "Invalid token" });
      return;
    }
    const body = (req.body ?? {}) as {
      report?: string;
      filialId?: string;
      xml?: string;
      rows?: unknown;
      fomId?: string;
      ch?: string;
      pharmacyName?: string;
    };
    const report = String(body.report ?? "").trim() as FomReportKey;
    const filialId = String(body.filialId ?? "1").trim() || "1";
    const fomId = String(body.fomId ?? "").trim();
    const ch = String(body.ch ?? "").trim();
    const pharmacyName = String(body.pharmacyName ?? "").trim();
    if (!AGENT_REPORTS.has(report)) {
      res.status(400).json({ ok: false, error: `Nomaʼlum hisobot: ${report}` });
      return;
    }
    const startedAt = new Date();
    try {
      const rows = Array.isArray(body.rows)
        ? (body.rows as Record<string, string>[])
        : parseFomXml(typeof body.xml === "string" ? body.xml : "");
      if (rows.length === 0) {
        res.json({ ok: true, report, filialId, fomId: fomId || null, rows: 0, imported: 0, message: "Boʻsh hisobot." });
        return;
      }
      const result = await importAgentReport({ report, filialId, rows, orgFomId: fomId || undefined });
      const who = [fomId && `Fom_ID ${fomId}`, ch && `CH ${ch}`, pharmacyName].filter(Boolean).join(" · ");
      const skipped = Math.max(0, rows.length - (result.imported || 0));
      await db.insert(integrationImportsTable).values({
        integration: "fom-agent",
        status: "success",
        startedAt,
        completedAt: new Date(),
        importedRecords: result.imported,
        message: `Agent: ${FOM_REPORTS[report].label} · filial ${filialId}${who ? ` · ${who}` : ""} · ${rows.length} qator → ${result.imported} import.`,
        details: JSON.stringify({
          report,
          filialId,
          fomId: fomId || null,
          ch: ch || null,
          pharmacyName: pharmacyName || null,
          rows: rows.length,
          imported: result.imported,
          skipped,
          sampleKeys: rows.slice(0, 3).map((row) => Object.keys(row).sort().join(",")),
        }),
      });
      res.json({
        ok: true,
        report,
        filialId,
        fomId: fomId || null,
        rows: rows.length,
        imported: result.imported,
        skipped,
        sampleKeys: rows.slice(0, 2).map((row) => Object.keys(row).sort()),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.insert(integrationImportsTable).values({
        integration: "fom-agent",
        status: "error",
        startedAt,
        completedAt: new Date(),
        message: `Agent: ${message}`.slice(0, 500),
      });
      res.status(400).json({ ok: false, error: message });
    }
  },
);
