import { timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import express, { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import {
  auditLogTable,
  branchesTable,
  counterpartiesTable,
  db,
  integrationImportsTable,
  integrationSettingsTable,
  inventoryBalancesTable,
  moneyTransactionsTable,
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
import {
  FOM_REPORTS,
  decodeXml,
  fomConfig,
  fomSavedConfig,
  fomSqlMode,
  parseFilialIds,
  parseFomXml,
  type FomConfig,
  type FomReportKey,
  type FomSavedConfig,
} from "../lib/fomClient";
import {
  DEFAULT_FOM_START_DATE,
  loadOrgFomConfig,
  orgFomConfigUpdatedAt,
  orgStartDate,
  resolveOrgFomConfig,
  saveFomSettings,
  saveOrgFomConfig,
  type OrgFomSavedConfig,
} from "../lib/fomSettings";
import {
  SQL_REPLACED_REPORTS,
  fomSyncRunning,
  importSitePush,
  startFomSync,
  testFomConnection,
  type SyncDetails,
} from "../lib/fomSync";
import { isOwnerSurface } from "../lib/ownerHost";

const router: IRouter = Router();

function lastTestKey(organizationId: number | null): string {
  return organizationId == null ? "fom_last_test" : `fom_last_test:org:${organizationId}`;
}

function orgIdOf(res: Response): number | null {
  const id = res.locals.organizationId as number | null | undefined;
  return id == null ? null : id;
}

/** Platform owner CRM (global FOM) vs company self-serve (org FOM). */
function useGlobalFom(res: Response): boolean {
  return res.locals.userRole === "platform_admin" && !res.locals.actingAsCompany && isOwnerSurface(res.req);
}

/** Company admin/finance self-serve, or platform admin (owner CRM / act-as). */
const fomEditors: RequestHandler = (_req, res, next) => {
  const role = String(res.locals.userRole ?? "");
  if (role === "platform_admin" || role === "admin" || role === "finance") {
    next();
    return;
  }
  res.status(403).json({ error: "Bu amal uchun ruxsat yo‘q." });
};

async function latestImport(integration: string, organizationId: number | null, statusFilter?: string) {
  const [row] = await db
    .select()
    .from(integrationImportsTable)
    .where(
      and(
        eq(integrationImportsTable.integration, integration),
        statusFilter ? eq(integrationImportsTable.status, statusFilter) : undefined,
        organizationId == null
          ? sql`${integrationImportsTable.organizationId} is null`
          : eq(integrationImportsTable.organizationId, organizationId),
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

async function orgBranchIds(organizationId: number): Promise<number[]> {
  const rows = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(eq(branchesTable.organizationId, organizationId));
  return rows.map((r) => r.id);
}

async function resolveRuntimeConfig(res: Response): Promise<{
  organizationId: number | null;
  config: FomConfig;
  saved: OrgFomSavedConfig | FomSavedConfig | null;
  startDate: string;
}> {
  if (useGlobalFom(res)) {
    return {
      organizationId: null,
      config: fomConfig(),
      saved: fomSavedConfig(),
      startDate: process.env.FOM_START_DATE?.trim() || DEFAULT_FOM_START_DATE,
    };
  }
  const organizationId = orgIdOf(res);
  if (organizationId == null) {
    return {
      organizationId: null,
      config: fomConfig(),
      saved: fomSavedConfig(),
      startDate: DEFAULT_FOM_START_DATE,
    };
  }
  const saved = await loadOrgFomConfig(organizationId);
  return {
    organizationId,
    config: resolveOrgFomConfig(saved),
    saved,
    startDate: orgStartDate(saved),
  };
}

async function readStatus(res: Response) {
  const { organizationId, config } = await resolveRuntimeConfig(res);
  const [lastImport, siteImport, lastTestRow] = await Promise.all([
    latestImport("fom", organizationId),
    latestImport("fom-site", organizationId),
    db
      .select()
      .from(integrationSettingsTable)
      .where(eq(integrationSettingsTable.key, lastTestKey(organizationId)))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  if (lastImport?.status === "running" && !fomSyncRunning(organizationId)) {
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
  const sitePushing =
    siteImport?.status === "success" && !!siteAt && Date.now() - siteAt.getTime() < 30 * 60_000;
  const pulling = lastTest && (!syncAt || new Date(lastTest.at) > syncAt) ? lastTest.ok : Boolean(syncOk);
  const connected = pulling || sitePushing;

  const branchIds = organizationId == null ? null : await orgBranchIds(organizationId);
  const branchScope = (col: AnyPgColumn) =>
    branchIds == null ? undefined : inArray(col, branchIds.length ? branchIds : [-1]);
  const orgMaster = (col: AnyPgColumn) =>
    organizationId == null ? undefined : eq(col, organizationId);

  const [branches, products, counterparties, stockLines, purchases, sales, stockDocuments] =
    await Promise.all([
      countWhere(
        db
          .select({ value: count() })
          .from(branchesTable)
          .where(and(eq(branchesTable.source, "fom"), orgMaster(branchesTable.organizationId))),
      ),
      countWhere(
        db
          .select({ value: count() })
          .from(productsTable)
          .where(and(eq(productsTable.source, "fom"), orgMaster(productsTable.organizationId))),
      ),
      countWhere(
        db
          .select({ value: count() })
          .from(counterpartiesTable)
          .where(and(isNotNull(counterpartiesTable.fomId), orgMaster(counterpartiesTable.organizationId))),
      ),
      countWhere(
        db
          .select({ value: count() })
          .from(inventoryBalancesTable)
          .where(
            and(
              eq(inventoryBalancesTable.source, "fom"),
              ne(inventoryBalancesTable.quantity, "0"),
              branchScope(inventoryBalancesTable.branchId),
            ),
          ),
      ),
      countWhere(
        db
          .select({ value: count() })
          .from(purchasesTable)
          .where(and(eq(purchasesTable.source, "fom"), branchScope(purchasesTable.branchId))),
      ),
      countWhere(
        db
          .select({ value: count() })
          .from(salesTable)
          .where(and(eq(salesTable.source, "fom"), branchScope(salesTable.branchId))),
      ),
      countWhere(
        db
          .select({ value: count() })
          .from(stockDocumentsTable)
          .where(and(eq(stockDocumentsTable.source, "fom"), branchScope(stockDocumentsTable.branchId))),
      ),
    ]);

  const token = config.siteToken;
  return GetFomStatusResponse.parse({
    connected,
    configured: Boolean(config.reportUrl),
    baseUrl: config.reportUrl,
    keyConfigured: Boolean(token),
    lastSyncAt: syncAt,
    lastSyncStatus: lastImport?.status ?? "not_started",
    lastMessage:
      lastImport?.message ||
      (config.reportUrl ? null : "FOM server manzili sozlanmagan (Sozlamalar → FOM ulanishi)."),
    importedRecords: lastImport?.importedRecords ?? 0,
    running: fomSyncRunning(organizationId),
    reportAvailable: true,
    filialIds: details?.filials?.length ? details.filials : config.filialIds,
    intervalMinutes: config.intervalMinutes,
    refsIntervalMinutes: config.refsIntervalMinutes,
    refsAt: details?.refsAt ?? null,
    lastSyncFrom: details?.from ?? null,
    lastSyncTo: details?.to ?? null,
    reports: Object.values(FOM_REPORTS)
      .filter((report) =>
        fomSqlMode(config) ? !SQL_REPLACED_REPORTS.has(report.key as FomReportKey) : report.id !== 0,
      )
      .map((report) => {
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
      lastAt: siteAt,
      lastStatus: siteImport?.status ?? null,
      lastMessage: siteImport?.message ?? null,
      lastRecords: siteImport?.importedRecords ?? 0,
    },
    totals: { branches, products, counterparties, stockLines, purchases, sales, stockDocuments },
    dataRanges: await dataRanges(organizationId, branchIds),
    // Extra field ignored by strict clients if schema lacks it; Zod object strips unknown by default —
    // keep startDate only in settings response.
  });
}

/** First / last FOM record per section in the PHARMXS database (cached briefly; polled often). */
const rangesCache = new Map<
  string,
  { at: number; value: Array<{ key: string; label: string; from: Date | null; to: Date | null; count: number }> }
>();

async function dataRanges(organizationId: number | null, branchIds: number[] | null) {
  const cacheKey = organizationId == null ? "global" : `org:${organizationId}`;
  const cached = rangesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10_000) return cached.value;
  const scope = (col: AnyPgColumn) =>
    branchIds == null ? undefined : inArray(col, branchIds.length ? branchIds : [-1]);
  const span = async (
    key: string,
    label: string,
    table: PgTable,
    column: AnyPgColumn,
    source: AnyPgColumn,
    branchCol: AnyPgColumn,
  ) => {
    const [row] = await db
      .select({ from: sql<string | null>`min(${column})`, to: sql<string | null>`max(${column})`, count: count() })
      .from(table)
      .where(and(eq(source, "fom"), scope(branchCol)));
    return {
      key,
      label,
      from: row?.from ? new Date(row.from) : null,
      to: row?.to ? new Date(row.to) : null,
      count: Number(row?.count ?? 0),
    };
  };
  const value = await Promise.all([
    span("sales", "Cheklar", salesTable, salesTable.soldAt, salesTable.source, salesTable.branchId),
    span(
      "purchases",
      "Kirim hujjatlari",
      purchasesTable,
      purchasesTable.receivedAt,
      purchasesTable.source,
      purchasesTable.branchId,
    ),
    span(
      "stock",
      "Tovar harakati hujjatlari",
      stockDocumentsTable,
      stockDocumentsTable.occurredAt,
      stockDocumentsTable.source,
      stockDocumentsTable.branchId,
    ),
    span(
      "money",
      "Kassa tushumlari (kunlik)",
      moneyTransactionsTable,
      moneyTransactionsTable.date,
      moneyTransactionsTable.source,
      moneyTransactionsTable.branchId,
    ),
  ]);
  rangesCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

router.get("/fom/status", async (_req, res): Promise<void> => {
  res.json(await readStatus(res));
});

function settingsView(
  config: FomConfig,
  saved: OrgFomSavedConfig | FomSavedConfig | null,
  updatedAt: Date | null,
  startDate: string,
) {
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
    startDate,
  });
}

router.get("/fom/settings", fomEditors, async (_req, res): Promise<void> => {
  if (useGlobalFom(res) || (res.locals.userRole === "platform_admin" && !orgIdOf(res))) {
    if (!isOwnerSurface(res.req) && res.locals.userRole === "platform_admin" && !orgIdOf(res)) {
      res.status(404).json({ error: "Platforma FOM sozlamalari faqat owner panelidan." });
      return;
    }
  }
  const { config, saved, startDate, organizationId } = await resolveRuntimeConfig(res);
  const updatedAt =
    organizationId == null
      ? (
          await db
            .select({ updatedAt: integrationSettingsTable.updatedAt })
            .from(integrationSettingsTable)
            .where(eq(integrationSettingsTable.key, "fom_config"))
            .limit(1)
        )[0]?.updatedAt ?? null
      : await orgFomConfigUpdatedAt(organizationId);
  res.json(settingsView(config, saved, updatedAt, startDate));
});

const HOST_PATTERN =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

router.put("/fom/settings", fomEditors, async (req, res): Promise<void> => {
  const parsed = SaveFomSettingsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const host = input.host.trim();
  if (!HOST_PATTERN.test(host)) {
    res.status(400).json({
      error: "Server manzili notoʻgʻri. Faqat IP yoki domen kiriting (masalan 84.54.70.12).",
    });
    return;
  }
  const filialIds = parseFilialIds(input.filialIds);
  if (filialIds.some((id) => !/^\d+$/.test(id))) {
    res.status(400).json({ error: "Filial ID lari faqat raqamlardan iborat boʻlishi kerak (masalan: 1, 2, 3)." });
    return;
  }

  const startDateRaw = input.startDate?.trim();
  const startDate =
    startDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(startDateRaw) ? startDateRaw : DEFAULT_FOM_START_DATE;

  const global = useGlobalFom(res) || (res.locals.userRole === "platform_admin" && orgIdOf(res) == null);
  if (global) {
    if (!isOwnerSurface(req)) {
      res.status(404).json({ error: "Platforma FOM sozlamalari faqat owner panelidan." });
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
      summary: `REPORT.exe (global): ${host}${input.port ? `:${input.port}` : ""}, filiallar: ${filialIds.join(", ") || "avtomatik"}`,
    });
    const { config, saved } = await resolveRuntimeConfig(res);
    const [row] = await db
      .select({ updatedAt: integrationSettingsTable.updatedAt })
      .from(integrationSettingsTable)
      .where(eq(integrationSettingsTable.key, "fom_config"))
      .limit(1);
    res.json(settingsView(config, saved, row?.updatedAt ?? null, startDate));
    return;
  }

  const organizationId = orgIdOf(res);
  if (organizationId == null) {
    res.status(400).json({ error: "Kompaniya tanlanmagan." });
    return;
  }
  const existing = await loadOrgFomConfig(organizationId);
  const prev = resolveOrgFomConfig(existing);
  const apiToken = input.clearApiToken ? null : input.apiToken?.trim() || prev.apiToken;
  const saved: OrgFomSavedConfig = {
    reportUrl: `${input.protocol}://${host}${input.port ? `:${input.port}` : ""}`,
    filialIds,
    intervalMinutes: input.intervalMinutes,
    initialDays: input.initialDays,
    timeoutMs: input.timeoutSeconds * 1000,
    apiToken,
    startDate,
  };
  await saveOrgFomConfig(organizationId, saved);
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "fom.settings.saved",
    entityType: "organization",
    entityId: String(organizationId),
    summary: `REPORT.exe: ${host}${input.port ? `:${input.port}` : ""}, filiallar: ${filialIds.join(", ") || "avtomatik"}, start=${startDate}`,
  });
  const config = resolveOrgFomConfig(saved);
  res.json(settingsView(config, saved, await orgFomConfigUpdatedAt(organizationId), orgStartDate(saved)));
});

router.post("/fom/test", fomEditors, async (_req, res): Promise<void> => {
  const { organizationId, config } = await resolveRuntimeConfig(res);
  const result = await testFomConnection(config);
  const value = JSON.stringify({ ok: result.ok, at: new Date().toISOString() });
  const key = lastTestKey(organizationId);
  await db
    .insert(integrationSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: integrationSettingsTable.key, set: { value, updatedAt: new Date() } });
  res.json(
    TestFomConnectionResponse.parse({
      status: result.ok ? "success" : "error",
      message: result.message,
      checkedAt: new Date(),
    }),
  );
});

router.post("/fom/sync", fomEditors, async (req, res): Promise<void> => {
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
  const { organizationId, config, startDate } = await resolveRuntimeConfig(res);
  if (!useGlobalFom(res) && organizationId == null && res.locals.userRole !== "platform_admin") {
    res.status(400).json({ error: "Kompaniya tanlanmagan." });
    return;
  }
  const result = await startFomSync({
    from: dateFrom ? new Date(dateFrom) : undefined,
    to: dateTo ? new Date(dateTo) : undefined,
    trigger: "manual",
    organizationId,
    config,
    startDate,
  });
  if (result.started) {
    await db.insert(auditLogTable).values({
      actorId: String(res.locals.userId),
      action: "fom.sync.started",
      entityType: organizationId == null ? "integration" : "organization",
      entityId: organizationId == null ? "fom" : String(organizationId),
      summary: result.message,
    });
  }
  res.json(
    SyncFomResponse.parse({
      status: result.started ? "running" : fomSyncRunning(organizationId) ? "running" : "error",
      message: result.message,
      checkedAt: new Date(),
    }),
  );
});

export default router;

// ---------------------------------------------------------------- SITE.exe (public, token protected)

export const fomSiteRouter: IRouter = Router();

function tokenFrom(req: Request): string {
  const header = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body =
    req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
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
      // Owner-managed SITE token: stamp null org (legacy) unless FOM_SITE_ORG_ID is set.
      const siteOrg = Number(process.env.FOM_SITE_ORG_ID) || null;
      const result = await importSitePush(rows, siteOrg);
      await db.insert(integrationImportsTable).values({
        integration: "fom-site",
        status: "success",
        startedAt,
        completedAt: new Date(),
        importedRecords: result.batches,
        message: `SITE.exe: ${result.batches} qoldiq qatori, ${result.products} tovar qabul qilindi.`,
        organizationId: siteOrg,
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
        organizationId: Number(process.env.FOM_SITE_ORG_ID) || null,
      });
      res.status(400).type("text/plain").send(message);
    }
  },
);
