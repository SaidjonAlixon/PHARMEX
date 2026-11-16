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
  organizationsTable,
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
  agentInfoFromSaved,
  applyAgentHello,
  buildFomAgentBatScript,
  buildFomAgentInstallScript,
  buildFomAgentUninstallBatScript,
  disconnectOrgAgent,
  ensureOrgAgentToken,
  resolveOrgByAgentToken,
  rotateOrgAgentToken,
} from "../lib/fomAgent";
import path from "node:path";
import fs from "node:fs";
import {
  DEFAULT_FOM_START_DATE,
  loadOrgFomConfig,
  orgFomConfigUpdatedAt,
  orgStartDate,
  resolveOrgFomConfig,
  resolveOrgFomConfigForSync,
  saveFomSettings,
  saveOrgFomConfig,
  type OrgFomSavedConfig,
} from "../lib/fomSettings";
import { completeAgentJob, failAgentJob, takeAgentJobs } from "../lib/fomAgentRelay";
import {
  SQL_REPLACED_REPORTS,
  discoverFomBranches,
  fomSyncRunning,
  importSitePush,
  startFomSync,
  testFomConnection,
  type SyncDetails,
} from "../lib/fomSync";
import { fetchFomReport } from "../lib/fomClient";
import { isOwnerSurface, PUBLIC_APP_URL } from "../lib/ownerHost";

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
    config: resolveOrgFomConfigForSync(organizationId, saved),
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
  const orgSaved =
    organizationId == null ? null : await loadOrgFomConfig(organizationId);
  const agent = agentInfoFromSaved(orgSaved);
  const connected = pulling || sitePushing || agent.online;

  const branchIds = organizationId == null ? null : await orgBranchIds(organizationId);
  const branchScope = (col: AnyPgColumn) =>
    branchIds == null ? undefined : inArray(col, branchIds.length ? branchIds : [-1]);
  const orgMaster = (col: AnyPgColumn) =>
    organizationId == null ? undefined : eq(col, organizationId);

  const totalsKey = organizationId == null ? "global" : `org:${organizationId}`;
  const totalsHit = totalsCache.get(totalsKey);
  const totals =
    totalsHit && Date.now() - totalsHit.at < 8_000
      ? totalsHit.value
      : await (async () => {
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
          const value = { branches, products, counterparties, stockLines, purchases, sales, stockDocuments };
          totalsCache.set(totalsKey, { at: Date.now(), value });
          return value;
        })();
  const { branches, products, counterparties, stockLines, purchases, sales, stockDocuments } = totals;

  const token = config.siteToken;
  return GetFomStatusResponse.parse({
    connected,
    configured: Boolean(config.reportUrl || config.agentRelay),
    baseUrl: config.reportUrl,
    keyConfigured: Boolean(token),
    lastSyncAt: syncAt,
    lastSyncStatus: lastImport?.status ?? "not_started",
    lastMessage:
      lastImport?.message ||
      (config.reportUrl || config.agentRelay
        ? config.agentRelay
          ? "Agent relay: maʼlumot dorixona kompyuteri orqali olinadi."
          : null
        : "FOM server manzili sozlanmagan (Sozlamalar → FOM ulanishi)."),
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
  });
}

function platformPublicUrl(req: Request): string {
  const env = PUBLIC_APP_URL();
  if (env && !/localhost|127\.0\.0\.1/i.test(env)) return env.replace(/\/+$/, "");
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0]?.trim() || "https";
  const host = (req.get("x-forwarded-host") || req.get("host") || "pharmxs.uz").split(",")[0]?.trim();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

/** First / last FOM record per section in the PHARMXS database (cached briefly; polled often). */
const rangesCache = new Map<
  string,
  { at: number; value: Array<{ key: string; label: string; from: Date | null; to: Date | null; count: number }> }
>();
const totalsCache = new Map<
  string,
  {
    at: number;
    value: {
      branches: number;
      products: number;
      counterparties: number;
      stockLines: number;
      purchases: number;
      sales: number;
      stockDocuments: number;
    };
  }
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
    ...existing,
    reportUrl: host
      ? `${input.protocol}://${host}${input.port ? `:${input.port}` : ""}`
      : existing?.reportUrl,
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

/** Probe live FOM filials (names + ids) via agent — used to verify discovery. */
router.post("/fom/discover-filials", fomEditors, async (_req, res): Promise<void> => {
  const { organizationId, config } = await resolveRuntimeConfig(res);
  if (organizationId == null) {
    res.status(400).json({ error: "Kompaniya tanlanmagan." });
    return;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const floor = new Date("2025-01-01");
  let orgRows: Awaited<ReturnType<typeof fetchFomReport>> = [];
  try {
    orgRows = await fetchFomReport(config, 189, config.filialIds[0] ?? "1", floor, today);
  } catch {
    orgRows = [];
  }
  const discovered = await discoverFomBranches(config, {
    configuredIds: [],
    floor,
    today,
    orgRows,
  });
  res.json({
    count: discovered.length,
    filials: discovered.map((r) => ({ id: r.I, name: r.N })),
    org189Apt: orgRows.filter((r) => r.I && (r.APT === "1" || r.APT?.toLowerCase() === "true")).map((r) => ({
      id: r.I,
      name: r.N,
      APT: r.APT,
    })),
  });
});

function agentExePath() {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/api-server/public/agent/PHARMXS-FOM-Agent.exe"),
    path.resolve(process.cwd(), "public/agent/PHARMXS-FOM-Agent.exe"),
    path.resolve(process.cwd(), "../api-server/public/agent/PHARMXS-FOM-Agent.exe"),
    path.resolve(process.cwd(), "../../artifacts/api-server/public/agent/PHARMXS-FOM-Agent.exe"),
    path.resolve(process.cwd(), "../fom-agent/release/PHARMXS-FOM-Agent.exe"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

router.get("/fom/agent", fomEditors, async (req, res): Promise<void> => {
  const organizationId = orgIdOf(res);
  if (organizationId == null) {
    res.status(400).json({ error: "Kompaniya tanlanmagan. Agent faqat kompaniya kabinetida." });
    return;
  }
  const token = await ensureOrgAgentToken(organizationId);
  const saved = await loadOrgFomConfig(organizationId);
  const agent = agentInfoFromSaved(saved);
  let preferredPort = saved?.agentPort ?? null;
  if (preferredPort == null && saved?.reportUrl) {
    try {
      preferredPort = Number(new URL(saved.reportUrl).port) || null;
    } catch {
      preferredPort = null;
    }
  }
  const platformUrl = platformPublicUrl(req);
  res.json({
    agent,
    token,
    platformUrl,
    preferredPort: preferredPort ?? 8084,
    downloadUrl: `${platformUrl}/api/fom/agent/download.exe`,
    exeAvailable: Boolean(agentExePath()),
    startDate: orgStartDate(saved),
  });
});

router.post("/fom/agent/rotate", fomEditors, async (req, res): Promise<void> => {
  const organizationId = orgIdOf(res);
  if (organizationId == null) {
    res.status(400).json({ error: "Kompaniya tanlanmagan." });
    return;
  }
  const token = await rotateOrgAgentToken(organizationId);
  const saved = await loadOrgFomConfig(organizationId);
  const platformUrl = platformPublicUrl(req);
  const preferredPort = saved?.agentPort && saved.agentPort > 0 ? saved.agentPort : 8084;
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "fom.agent.rotated",
    entityType: "organization",
    entityId: String(organizationId),
    summary: "FOM agent token yangilandi",
  });
  res.json({
    agent: agentInfoFromSaved(saved),
    token,
    platformUrl,
    preferredPort,
    downloadUrl: `${platformUrl}/api/fom/agent/download.exe`,
    exeAvailable: Boolean(agentExePath()),
    startDate: orgStartDate(saved),
  });
});

router.post("/fom/agent/disconnect", fomEditors, async (req, res): Promise<void> => {
  const organizationId = orgIdOf(res);
  if (organizationId == null) {
    res.status(400).json({ error: "Kompaniya tanlanmagan." });
    return;
  }
  await disconnectOrgAgent(organizationId);
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "fom.agent.disconnected",
    entityType: "organization",
    entityId: String(organizationId),
    summary: "FOM agent uzildi",
  });
  const saved = await loadOrgFomConfig(organizationId);
  const platformUrl = platformPublicUrl(req);
  res.json({
    agent: agentInfoFromSaved(saved),
    token: null,
    platformUrl,
    preferredPort: saved?.agentPort ?? 8084,
    downloadUrl: `${platformUrl}/api/fom/agent/download.exe`,
    exeAvailable: Boolean(agentExePath()),
    startDate: orgStartDate(saved),
    message: "Agent uzildi. «Tokenni yangilash» bilan yangi token oling.",
  });
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

async function resolveInstallToken(req: Request): Promise<{
  token: string;
  organizationId: number;
  preferredPort: number | null;
} | null> {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!token) return null;
  const { resolveOrgByAgentToken } = await import("../lib/fomAgent");
  const organizationId = await resolveOrgByAgentToken(token);
  if (organizationId == null) return null;
  const saved = await loadOrgFomConfig(organizationId);
  if (!saved?.agentToken || saved.agentToken !== token) return null;
  let preferredPort = saved.agentPort ?? null;
  if (preferredPort == null && saved.reportUrl) {
    try {
      preferredPort = Number(new URL(saved.reportUrl).port) || null;
    } catch {
      preferredPort = null;
    }
  }
  return { token, organizationId, preferredPort };
}

/**
 * Agent: push filial names read from local MSSQL (dbo.ORG APT=1 / dbo.OTDEL).
 * Used when report 189 returns HTML on older ServiceReports installs.
 */
fomSiteRouter.post("/fom/agent/push-org-names", express.json({ limit: "4mb" }), async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as {
      token?: string;
      orgs?: Array<{ I?: string; N?: string; APT?: string; INC?: string; INN?: string; NAME?: string }>;
    };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      res.status(401).json({ ok: false, message: "Token yoq." });
      return;
    }
    const organizationId = await resolveOrgByAgentToken(token);
    if (organizationId == null) {
      res.status(401).json({ ok: false, message: "Token notogri." });
      return;
    }
    const score = (s?: string) => {
      const t = s?.trim() ?? "";
      if (!t || /^(filial|филиал)\s*\d+$/i.test(t) || /^\d+$/.test(t)) return -1;
      if (/^Kontragent\s*#/i.test(t)) return -1;
      if (/[А-Яа-яЁёЎўҚқҒғҲҳ]/.test(t)) return 40 + Math.min(t.length, 40);
      if (/[A-Za-zА-Яа-я]/.test(t) && t.length >= 3) return 20 + Math.min(t.length, 20);
      return 1;
    };
    const isFlag = (v?: string) => v === "1" || v === "true" || v === "True";
    const byId = new Map<string, { name: string; apt: boolean; inc: boolean; inn: string }>();
    for (const row of body.orgs ?? []) {
      const id = String(row.I ?? "").trim();
      const label = String(row.N ?? row.NAME ?? "").trim();
      if (!/^\d+$/.test(id) || score(label) < 20) continue;
      const prev = byId.get(id);
      if (!prev || score(label) >= score(prev.name)) {
        byId.set(id, {
          name: label,
          apt: isFlag(row.APT),
          inc: isFlag(row.INC),
          inn: String(row.INN ?? "").trim(),
        });
      }
    }
    const updated: Array<{ id: string; name: string }> = [];
    let suppliers = 0;
    for (const [fomId, meta] of byId) {
      if (meta.apt) {
        const kind = /склад|sklad|ombor|склад/i.test(meta.name) ? "warehouse" : "pharmacy";
        const result = await db
          .insert(branchesTable)
          .values({
            name: meta.name,
            fomId,
            kind,
            source: "fom",
            organizationId,
          })
          .onConflictDoUpdate({
            target: [branchesTable.organizationId, branchesTable.source, branchesTable.fomId],
            set: {
              name: sql`excluded.name`,
              kind: sql`excluded.kind`,
            },
          })
          .returning({ fomId: branchesTable.fomId, name: branchesTable.name });
        if (result[0]) updated.push({ id: result[0].fomId!, name: result[0].name });
      }
      // Yetkazib beruvchilar: INC yoki APT boʻlmagan nomli tashkilotlar.
      if (meta.inc || !meta.apt) {
        await db
          .insert(counterpartiesTable)
          .values({
            name: meta.name,
            kind: "supplier",
            fomId,
            taxId: meta.inn,
            note: "FOM: yetkazib beruvchi",
            organizationId,
          })
          .onConflictDoUpdate({
            target: [counterpartiesTable.organizationId, counterpartiesTable.kind, counterpartiesTable.fomId],
            set: {
              name: sql`excluded.name`,
              taxId: sql`CASE WHEN excluded.tax_id <> '' THEN excluded.tax_id ELSE ${counterpartiesTable.taxId} END`,
            },
          });
        suppliers += 1;
      }
    }
    // Backfill purchase rows that still show "Kontragent #id".
    let purchasesFixed = 0;
    if (byId.size) {
      const result = await db.execute(sql`
        UPDATE pharmacy_purchases AS p
        SET supplier_name = c.name,
            counterparty_id = COALESCE(p.counterparty_id, c.id)
        FROM pharmacy_counterparties AS c
        WHERE c.organization_id = ${organizationId}
          AND c.kind = 'supplier'
          AND c.fom_id IS NOT NULL
          AND (
            p.supplier_name = 'Kontragent #' || c.fom_id
            OR p.supplier_name ~ ('^Kontragent[[:space:]]*#' || c.fom_id || '$')
          )
          AND p.source = 'fom'
          AND p.branch_id IN (
            SELECT id FROM pharmacy_branches
            WHERE organization_id = ${organizationId}
          )
      `);
      purchasesFixed = Number((result as { rowCount?: number }).rowCount ?? 0);
    }
    res.json({
      ok: true,
      named: byId.size,
      branches: updated.length,
      suppliers,
      purchasesFixed,
      updated,
      sample: [...byId.entries()].slice(0, 20).map(([id, meta]) => ({ I: id, N: meta.name, APT: meta.apt ? "1" : "0", INC: meta.inc ? "1" : "0" })),
    });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

/** Agent: pull report 189 and rename branches to Cyrillic ORG names when available. */
fomSiteRouter.post("/fom/agent/refresh-branch-names", express.json({ limit: "16kb" }), async (req, res): Promise<void> => {
  try {
    const token = typeof (req.body as { token?: string })?.token === "string"
      ? (req.body as { token: string }).token.trim()
      : "";
    if (!token) {
      res.status(401).json({ ok: false, message: "Token yoq." });
      return;
    }
    const organizationId = await resolveOrgByAgentToken(token);
    if (organizationId == null) {
      res.status(401).json({ ok: false, message: "Token notogri." });
      return;
    }
    const saved = await loadOrgFomConfig(organizationId);
    if (!saved?.agentToken || saved.agentToken !== token) {
      res.status(401).json({ ok: false, message: "Token notogri." });
      return;
    }
    const config = resolveOrgFomConfigForSync(organizationId, { ...saved, agentRelay: true });
    const today = new Date();
    const floor = new Date("2025-01-01");
    let rows: Awaited<ReturnType<typeof fetchFomReport>> = [];
    try {
      rows = await fetchFomReport(config, 189, saved.filialIds?.[0] ?? "1", floor, today);
    } catch (error) {
      res.json({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        rows: 0,
      });
      return;
    }
    const score = (s?: string) => {
      const t = s?.trim() ?? "";
      if (!t || /^filial\s+\d+$/i.test(t) || /^\d+$/.test(t)) return -1;
      if (/[А-Яа-яЁёЎўҚқҒғҲҳ]/.test(t)) return 40 + Math.min(t.length, 40);
      if (/[A-Za-zА-Яа-я]/.test(t) && t.length >= 3) return 20 + Math.min(t.length, 20);
      return 1;
    };
    const byId = new Map<string, string>();
    for (const row of rows) {
      if (!row.I) continue;
      const label = (row.N ?? row.ON ?? row.NAME ?? "").trim();
      if (score(label) < 20) continue;
      const prev = byId.get(row.I);
      if (!prev || score(label) >= score(prev)) byId.set(row.I, label);
      if ((row.APT === "1" || row.APT?.toLowerCase() === "true") && score(label) >= 20) {
        byId.set(row.I, label);
      }
    }
    const updated: Array<{ id: string; name: string }> = [];
    for (const [fomId, name] of byId) {
      const result = await db
        .update(branchesTable)
        .set({ name })
        .where(and(
          eq(branchesTable.organizationId, organizationId),
          eq(branchesTable.source, "fom"),
          eq(branchesTable.fomId, fomId),
        ))
        .returning({ fomId: branchesTable.fomId, name: branchesTable.name });
      if (result[0]) updated.push({ id: result[0].fomId!, name: result[0].name });
    }
    res.json({
      ok: true,
      org189: rows.length,
      named: byId.size,
      updated,
      sample: rows.slice(0, 15).map((r) => ({
        I: r.I,
        N: r.N,
        APT: r.APT,
        ON: r.ON,
        keys: Object.keys(r),
      })),
    });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

/** Agent debug: sample one REPORT and return field keys + short rows (for filial names). */
fomSiteRouter.post("/fom/agent/sample-report", express.json({ limit: "16kb" }), async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as { token?: string; reportId?: number; filialId?: string };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      res.status(401).json({ ok: false, message: "Token yoq." });
      return;
    }
    const organizationId = await resolveOrgByAgentToken(token);
    if (organizationId == null) {
      res.status(401).json({ ok: false, message: "Token notogri." });
      return;
    }
    const saved = await loadOrgFomConfig(organizationId);
    if (!saved?.agentToken || saved.agentToken !== token) {
      res.status(401).json({ ok: false, message: "Token notogri." });
      return;
    }
    const reportId = Number(body.reportId) > 0 ? Number(body.reportId) : 6;
    const filialId = typeof body.filialId === "string" && /^\d+$/.test(body.filialId) ? body.filialId : "1";
    const config = resolveOrgFomConfigForSync(organizationId, { ...saved, agentRelay: true });
    const today = new Date();
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 30);
    const rows = await fetchFomReport(config, reportId, filialId, from, today);
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
    const cyr = rows
      .flatMap((r) => Object.entries(r).map(([k, v]) => ({ k, v })))
      .filter((x) => /[А-Яа-яЁёЎўҚқҒғҲҳ]/.test(x.v))
      .slice(0, 40);
    res.json({
      ok: true,
      reportId,
      filialId,
      count: rows.length,
      keys,
      cyrillicSamples: cyr,
      sample: rows.slice(0, 5),
    });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

/** Public: Windows desktop agent (.exe). */
fomSiteRouter.get("/fom/agent/download.exe", async (_req, res): Promise<void> => {
  const exe = agentExePath();
  if (!exe) {
    res.status(404).json({
      error: "Agent dasturi hali joylanmagan. Tez orada yuklab olish mumkin boʻladi.",
    });
    return;
  }
  res.setHeader("Content-Type", "application/vnd.microsoft.portable-executable");
  res.setHeader("Content-Disposition", 'attachment; filename="PHARMXS-FOM-Agent.exe"');
  fs.createReadStream(exe).pipe(res);
});

/** Public: live sync progress for the desktop agent (token-scoped to one company). */
fomSiteRouter.post("/fom/agent/live", express.json({ limit: "16kb" }), async (req, res): Promise<void> => {
  try {
    const token = typeof (req.body as { token?: string })?.token === "string"
      ? (req.body as { token: string }).token.trim()
      : "";
    if (!token) {
      res.status(401).json({ ok: false, message: "Token yoʻq." });
      return;
    }
    const organizationId = await resolveOrgByAgentToken(token);
    if (organizationId == null) {
      res.status(401).json({ ok: false, message: "Token notoʻgʻri." });
      return;
    }
    const saved = await loadOrgFomConfig(organizationId);
    const agent = agentInfoFromSaved(saved);
    const [org] = await db
      .select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1);
    const [lastImport] = await db
      .select()
      .from(integrationImportsTable)
      .where(
        and(
          eq(integrationImportsTable.organizationId, organizationId),
          eq(integrationImportsTable.integration, "fom"),
        ),
      )
      .orderBy(desc(integrationImportsTable.startedAt))
      .limit(1);
    const details = parseDetails(lastImport?.details);
    const pctMatch = /(\d+)\s*%/.exec(lastImport?.message ?? "");
    const percent =
      lastImport?.status === "success"
        ? 100
        : pctMatch
          ? Number(pctMatch[1])
          : details?.progress && details.progress.total > 0
            ? Math.min(99, Math.floor((details.progress.done * 100) / details.progress.total))
            : lastImport?.status === "running"
              ? 1
              : 0;
    const branchIds = (
      await db
        .select({ id: branchesTable.id })
        .from(branchesTable)
        .where(and(eq(branchesTable.organizationId, organizationId), eq(branchesTable.source, "fom")))
    ).map((r) => r.id);
    const [branchCount] = await db
      .select({ value: count() })
      .from(branchesTable)
      .where(and(eq(branchesTable.organizationId, organizationId), eq(branchesTable.source, "fom")));
    const [productCount] = await db
      .select({ value: count() })
      .from(productsTable)
      .where(and(eq(productsTable.organizationId, organizationId), eq(productsTable.source, "fom")));
    const [purchaseCount] = branchIds.length
      ? await db
          .select({ value: count() })
          .from(purchasesTable)
          .where(and(eq(purchasesTable.source, "fom"), inArray(purchasesTable.branchId, branchIds)))
      : [{ value: 0 }];
    const [saleCount] = branchIds.length
      ? await db
          .select({ value: count() })
          .from(salesTable)
          .where(and(eq(salesTable.source, "fom"), inArray(salesTable.branchId, branchIds)))
      : [{ value: 0 }];
    res.json({
      ok: true,
      organizationId,
      companyName: org?.name ?? null,
      online: agent.online,
      platformOnline: agent.online,
      message: lastImport?.message || (agent.online ? "Agent ulangan" : "Agent kutilmoqda"),
      sync: {
        running: fomSyncRunning(organizationId) || lastImport?.status === "running",
        status: lastImport?.status ?? "not_started",
        percent,
        message: lastImport?.message ?? "Hali tortish boshlanmagan",
        from: details?.from ?? saved?.startDate ?? DEFAULT_FOM_START_DATE,
        to: details?.to ?? null,
        filials: details?.filials ?? saved?.filialIds ?? [],
        lastAt: (lastImport?.completedAt ?? lastImport?.startedAt)?.toISOString?.() ?? null,
        reports: details?.reports ?? {},
        totals: {
          branches: Number(branchCount?.value ?? 0),
          products: Number(productCount?.value ?? 0),
          purchases: Number(purchaseCount?.value ?? 0),
          sales: Number(saleCount?.value ?? 0),
        },
      },
    });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

/** Public: download install script by agent token (for one-liner paste). */
fomSiteRouter.get("/fom/agent/install.ps1", async (req, res): Promise<void> => {
  try {
    const resolved = await resolveInstallToken(req);
    if (!resolved) {
      res.status(401).type("text/plain").send("# Token notogri");
      return;
    }
    const script = buildFomAgentInstallScript({
      platformUrl: platformPublicUrl(req),
      token: resolved.token,
      preferredPort: resolved.preferredPort,
    });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="pharmxs-fom-agent.ps1"');
    res.send(script);
  } catch (error) {
    res.status(500).type("text/plain").send(`# Xato: ${error instanceof Error ? error.message : String(error)}`);
  }
});

/** Public: Admin-elevating .bat — double-click or run from CMD. */
fomSiteRouter.get("/fom/agent/install.bat", async (req, res): Promise<void> => {
  try {
    const resolved = await resolveInstallToken(req);
    if (!resolved) {
      res.status(401).type("text/plain").send("@echo off\r\necho Token notogri\r\npause\r\n");
      return;
    }
    const bat = buildFomAgentBatScript({
      platformUrl: platformPublicUrl(req),
      token: resolved.token,
    });
    res.setHeader("Content-Type", "application/octet-stream; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="pharmxs-fom-agent.bat"');
    res.send(bat);
  } catch (error) {
    res.status(500).type("text/plain").send(`@echo off\r\necho Xato\r\npause\r\n`);
  }
});

/** Public: fully remove agent tasks/watchdog/files (no token required). */
fomSiteRouter.get("/fom/agent/uninstall.bat", async (_req, res): Promise<void> => {
  try {
    const bat = buildFomAgentUninstallBatScript();
    res.setHeader("Content-Type", "application/octet-stream; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="pharmxs-fom-uninstall.bat"');
    res.send(bat);
  } catch {
    res.status(500).type("text/plain").send("@echo off\r\necho Xato\r\npause\r\n");
  }
});

/** Public: agent token starts full FOM pull for that company (install bat calls this). */
fomSiteRouter.post("/fom/agent/start-sync", express.json({ limit: "16kb" }), async (req, res): Promise<void> => {
  try {
    const token = typeof (req.body as { token?: string })?.token === "string"
      ? (req.body as { token: string }).token.trim()
      : "";
    if (!token) {
      res.status(401).json({ ok: false, message: "Token yoq." });
      return;
    }
    const { resolveOrgByAgentToken } = await import("../lib/fomAgent");
    const organizationId = await resolveOrgByAgentToken(token);
    if (organizationId == null) {
      res.status(401).json({ ok: false, message: "Token notogri." });
      return;
    }
    const saved = await loadOrgFomConfig(organizationId);
    if (!saved?.agentToken || saved.agentToken !== token) {
      res.status(401).json({ ok: false, message: "Token notogri." });
      return;
    }
    // Full pull from company startDate (default 2025-01-01) → today, then refresh every 5s.
    // Optional body.from / body.to (YYYY-MM-DD) for catch-up windows without wiping history.
    const body = (req.body ?? {}) as { from?: string; to?: string };
    saved.agentRelay = true;
    if (!saved.startDate?.trim()) saved.startDate = DEFAULT_FOM_START_DATE;
    saved.intervalMinutes = 1;
    saved.intervalSeconds = 5;
    await saveOrgFomConfig(organizationId, saved);
    const config = resolveOrgFomConfigForSync(organizationId, saved);
    const startDate = orgStartDate(saved);
    const fromRaw = typeof body.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from.trim()) ? body.from.trim() : null;
    const toRaw = typeof body.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.to.trim()) ? body.to.trim() : null;
    const from = new Date(`${fromRaw ?? startDate}T00:00:00.000Z`);
    const to = toRaw ? new Date(`${toRaw}T00:00:00.000Z`) : new Date();
    const result = await startFomSync({
      trigger: "manual",
      organizationId,
      config,
      startDate,
      from,
      to,
    });
    const rangeLabel = `${(fromRaw ?? startDate)} — ${toRaw ?? "bugun"}`;
    res.json({
      ok: result.started || fomSyncRunning(organizationId),
      started: result.started,
      message: result.started
        ? `Tortish boshlandi: ${rangeLabel}. Mavjud yozuvlar saqlanadi (FOM ID boʻyicha yangilanadi).`
        : result.message,
    });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

/** Public: pharmacy PC PowerShell agent hello / heartbeat (token in body). */
fomSiteRouter.post("/fom/agent/hello", express.json({ limit: "64kb" }), async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      res.status(401).json({ ok: false, message: "Token yoʻq." });
      return;
    }
    const portRaw = Number(body.port);
    const versionRaw = Number(body.agentVersion);
    const { organizationId, saved, configUrl } = await applyAgentHello({
      token,
      host: typeof body.host === "string" ? body.host : undefined,
      port: Number.isFinite(portRaw) ? portRaw : undefined,
      machine: typeof body.machine === "string" ? body.machine : undefined,
      localIps: Array.isArray(body.localIps)
        ? body.localIps.filter((x): x is string => typeof x === "string").slice(0, 12)
        : undefined,
      reportListening: typeof body.reportListening === "boolean" ? body.reportListening : undefined,
      protocol: body.protocol === "https" ? "https" : "http",
      agentVersion: Number.isFinite(versionRaw) ? versionRaw : undefined,
    });

    // Prefer agent relay: pharmacy PC reads REPORT locally (works behind NAT).
    if (saved.agentRelay === false) {
      saved.agentRelay = true;
      await saveOrgFomConfig(organizationId, saved, { reschedule: true });
    }
    const cfg = resolveOrgFomConfigForSync(organizationId, saved);

    let testOk = false;
    let testMessage = "FOM manzili hali tayyor emas.";
    let mode: "direct" | "relay" = "relay";
    if (cfg.agentRelay) {
      testOk = saved.agentReportListening !== false;
      testMessage = saved.agentReportListening === false
        ? "Agent relay yoqilgan, lekin REPORT.exe tinglanmayapti — FOM ni ishga tushiring."
        : "Agent relay: REPORT lokal tinglanmoqda — maʼlumot dorixona kompyuteri orqali olinadi.";
      mode = "relay";
    } else if (cfg.reportUrl) {
      const test = await testFomConnection(cfg);
      testOk = test.ok;
      testMessage = test.message;
      mode = "direct";
    }
    const key = `fom_last_test:org:${organizationId}`;
    const value = JSON.stringify({ ok: testOk, at: new Date().toISOString(), via: mode });
    await db
      .insert(integrationSettingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: integrationSettingsTable.key, set: { value, updatedAt: new Date() } });

    // Do not auto-start sync on hello — worker must be polling first.
    // User clicks «Birinchi toʻliq tortish» or scheduler picks up after agent is online.
    const syncStarted = false;
    const agentVersion = Number(saved.agentVersion) || 0;
    const placeholderBranches = await db
      .select({ fomId: branchesTable.fomId, name: branchesTable.name })
      .from(branchesTable)
      .where(
        and(
          eq(branchesTable.organizationId, organizationId),
          eq(branchesTable.source, "fom"),
          sql`${branchesTable.name} ~* '^(filial|филиал)[[:space:]]*[0-9]+$'`,
        ),
      );
    let message = testOk
      ? mode === "relay"
        ? "Kompyuter ulandi. Maʼlumot lokal REPORT orqali tortiladi (NAT/firewall muammosiz)."
        : "Kompyuter platformaga ulandi. FOM javob berdi."
      : "Kompyuter roʻyxatdan oʻtdi. REPORT.exe ni tekshiring.";
    if (placeholderBranches.length > 0 && agentVersion < 2) {
      message =
        "Filial nomlari uchun yangi Agent kerak: ish stolidan yoki admin paneldan PHARMXS-FOM-Agent.exe ni yuklab, eski agentni yopib qayta ishga tushiring — nomlar FOM bazadan (ORG) olinadi.";
    } else if (placeholderBranches.length > 0 && agentVersion >= 2) {
      message = "Agent ulandi. Filial nomlari FOM SQL (ORG) dan olinmoqda…";
    }

    res.json({
      ok: true,
      message,
      organizationId,
      reportUrl: configUrl,
      testOk,
      testMessage,
      syncStarted,
      mode,
      pollJobs: true,
      nextHeartbeatSec: 60,
      agentVersion,
      needOrgSql: placeholderBranches.length > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, message });
  }
});

/** Agent polls pending REPORT fetch jobs (platform → pharmacy PC → REPORT.exe). */
fomSiteRouter.post("/fom/agent/poll", express.json({ limit: "32kb" }), async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      res.status(401).json({ ok: false, message: "Token yoʻq." });
      return;
    }
    const { resolveOrgByAgentToken } = await import("../lib/fomAgent");
    const organizationId = await resolveOrgByAgentToken(token);
    if (organizationId == null) {
      res.status(401).json({ ok: false, message: "Token notoʻgʻri." });
      return;
    }
    const { touchOrgAgentPoll } = await import("../lib/fomSettings");
    const saved = await touchOrgAgentPoll(organizationId);
    const port = saved?.agentPort && saved.agentPort > 0 ? saved.agentPort : 8084;
    const jobs = takeAgentJobs(organizationId, 8).map((j) => ({
      ...j,
      localUrl: `http://127.0.0.1:${port}/P_GetReport_XML?pDateFrom=${encodeURIComponent(j.from)}&pDateTo=${encodeURIComponent(j.to)}&pFilial_id=${encodeURIComponent(j.filialId)}&pReport_id=${j.reportId}`,
    }));
    res.json({ ok: true, jobs, sleepSec: jobs.length ? 0 : 1 });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

/** Agent posts REPORT XML result for a job. */
fomSiteRouter.post(
  "/fom/agent/job-result",
  express.json({ limit: "512mb" }),
  async (req, res): Promise<void> => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
      if (!token || !jobId) {
        res.status(400).json({ ok: false, message: "token va jobId kerak." });
        return;
      }
      const { resolveOrgByAgentToken } = await import("../lib/fomAgent");
      const organizationId = await resolveOrgByAgentToken(token);
      if (organizationId == null) {
        res.status(401).json({ ok: false, message: "Token notoʻgʻri." });
        return;
      }
      if (body.ok === false) {
        failAgentJob(jobId, typeof body.message === "string" ? body.message : "REPORT xato");
        res.json({ ok: true });
        return;
      }
      let xml = typeof body.xml === "string" ? body.xml : "";
      if (!xml.trim() && typeof body.xmlBase64 === "string" && body.xmlBase64.trim()) {
        try {
          xml = Buffer.from(body.xmlBase64.trim(), "base64").toString("utf8");
        } catch {
          failAgentJob(jobId, "xmlBase64 yaroqsiz");
          res.status(400).json({ ok: false, message: "xmlBase64 yaroqsiz." });
          return;
        }
      }
      if (!xml.trim()) {
        failAgentJob(jobId, "Boʻsh XML");
        res.status(400).json({ ok: false, message: "xml boʻsh." });
        return;
      }
      const accepted = completeAgentJob(jobId, xml);
      res.json({ ok: accepted });
    } catch (error) {
      res.status(400).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  },
);

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
