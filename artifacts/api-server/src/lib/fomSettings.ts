import { and, desc, eq, like } from "drizzle-orm";
import { db, integrationImportsTable, integrationSettingsTable } from "@workspace/db";
import { logger } from "./logger";
import {
  fomConfig,
  fomEnvConfig,
  setSavedFomConfig,
  type FomConfig,
  type FomSavedConfig,
} from "./fomClient";
import { startFomSync } from "./fomSync";

const SETTINGS_KEY = "fom_config";
const ORG_KEY_PREFIX = "fom_config:org:";

/** Default first full-pull floor when org has no custom startDate. */
export const DEFAULT_FOM_START_DATE = "2025-01-01";

export type OrgFomSavedConfig = FomSavedConfig & {
  /** ISO date YYYY-MM-DD — first full sync floor */
  startDate?: string;
  /** Auto refresh cadence in seconds after the first full pull (default 5). */
  intervalSeconds?: number;
  /** Pharmacy PC agent (PowerShell) */
  agentToken?: string;
  agentHost?: string;
  agentPort?: number;
  agentMachine?: string;
  agentLocalIps?: string[];
  agentReportListening?: boolean;
  agentLastSeenAt?: string;
  /** Last successful /api/fom/agent/poll — required for relay pulls. */
  agentLastPollAt?: string;
  /** Desktop agent build (2+ reads filial names from local MSSQL ORG/OTDEL). */
  agentVersion?: number;
  /** Fetch REPORT via pharmacy PowerShell agent (when cloud cannot reach public IP). */
  agentRelay?: boolean;
};

const ORG_ONLY_KEYS = new Set([
  "startDate",
  "intervalSeconds",
  "agentToken",
  "agentHost",
  "agentPort",
  "agentMachine",
  "agentLocalIps",
  "agentReportListening",
  "agentLastSeenAt",
  "agentLastPollAt",
  "agentVersion",
  "agentRelay",
]);

export function orgFomSettingsKey(organizationId: number): string {
  return `${ORG_KEY_PREFIX}${organizationId}`;
}

export async function loadFomSettings(): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(integrationSettingsTable)
      .where(eq(integrationSettingsTable.key, SETTINGS_KEY))
      .limit(1);
    setSavedFomConfig(row ? (JSON.parse(row.value) as FomSavedConfig) : null);
  } catch (error) {
    logger.error({ err: error }, "FOM settings could not be loaded; using env");
  }
}

export async function saveFomSettings(value: FomSavedConfig): Promise<void> {
  const json = JSON.stringify(value);
  await db
    .insert(integrationSettingsTable)
    .values({ key: SETTINGS_KEY, value: json })
    .onConflictDoUpdate({ target: integrationSettingsTable.key, set: { value: json, updatedAt: new Date() } });
  setSavedFomConfig(value);
  scheduleFomSync();
}

export async function loadOrgFomConfig(organizationId: number): Promise<OrgFomSavedConfig | null> {
  const [row] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.key, orgFomSettingsKey(organizationId)))
    .limit(1);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as OrgFomSavedConfig;
  } catch {
    return null;
  }
}

export async function saveOrgFomConfig(
  organizationId: number,
  value: OrgFomSavedConfig,
  opts?: { reschedule?: boolean },
): Promise<void> {
  const json = JSON.stringify(value);
  const key = orgFomSettingsKey(organizationId);
  await db
    .insert(integrationSettingsTable)
    .values({ key, value: json })
    .onConflictDoUpdate({ target: integrationSettingsTable.key, set: { value: json, updatedAt: new Date() } });
  // Agent poll updates must NOT reset the auto-sync timer (was hammering CPU/DB every ~1s).
  if (opts?.reschedule !== false) scheduleFomSync();
}

/** Lightweight heartbeat: only last-seen timestamps, no scheduler reset. */
export async function touchOrgAgentPoll(organizationId: number): Promise<OrgFomSavedConfig | null> {
  const existing = await loadOrgFomConfig(organizationId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const prev = existing.agentLastPollAt ? new Date(existing.agentLastPollAt).getTime() : 0;
  const next = { ...existing, agentLastPollAt: now, agentLastSeenAt: now };
  // Persist at most every 20s — online check only needs recent poll.
  if (!Number.isFinite(prev) || Date.now() - prev > 20_000) {
    await saveOrgFomConfig(organizationId, next, { reschedule: false });
  }
  return next;
}

export async function orgFomConfigUpdatedAt(organizationId: number): Promise<Date | null> {
  const [row] = await db
    .select({ updatedAt: integrationSettingsTable.updatedAt })
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.key, orgFomSettingsKey(organizationId)))
    .limit(1);
  return row?.updatedAt ?? null;
}

/** Merge timeouts/defaults with org-saved settings. Unconfigured orgs stay blank (no global env host leak). */
export function resolveOrgFomConfig(saved: OrgFomSavedConfig | null): FomConfig {
  const env = fomEnvConfig();
  if (!saved) {
    return {
      ...env,
      reportUrl: null,
      filialIds: [],
      intervalMinutes: 0,
      apiToken: null,
    };
  }
  const merged = { ...env };
  for (const [key, value] of Object.entries(saved) as Array<[keyof OrgFomSavedConfig, unknown]>) {
    if (ORG_ONLY_KEYS.has(key)) continue;
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  if (saved.agentRelay) {
    merged.agentRelay = true;
    merged.agentOrganizationId = undefined; // set by caller with org id
    merged.agentLocalPort = saved.agentPort && saved.agentPort > 0 ? saved.agentPort : 8084;
    // Placeholder so status/UI treat org as configured even when public IP is unreachable
    if (!merged.reportUrl) {
      merged.reportUrl = `http://127.0.0.1:${merged.agentLocalPort}`;
    }
  }
  return merged;
}

/**
 * Pharmacy-PC pull (no Radmin/VPN): VPS queues REPORT jobs; FOM PC PowerShell
 * fetches localhost SERVICEREPORTS and posts XML back over HTTPS outbound.
 */
export function resolveOrgFomConfigForSync(organizationId: number, saved: OrgFomSavedConfig | null): FomConfig {
  const cfg = resolveOrgFomConfig(saved);
  const port = saved?.agentPort && saved.agentPort > 0 ? saved.agentPort : 8084;
  cfg.agentRelay = true;
  cfg.agentOrganizationId = organizationId;
  cfg.agentLocalPort = port;
  cfg.reportUrl = `http://127.0.0.1:${port}`;
  return cfg;
}

export function orgStartDate(saved: OrgFomSavedConfig | null): string {
  const raw = saved?.startDate?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const env = process.env.FOM_START_DATE?.trim();
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env)) return env;
  return DEFAULT_FOM_START_DATE;
}

export async function listOrgFomConfigs(): Promise<Array<{ organizationId: number; saved: OrgFomSavedConfig }>> {
  const rows = await db
    .select()
    .from(integrationSettingsTable)
    .where(like(integrationSettingsTable.key, `${ORG_KEY_PREFIX}%`));
  const out: Array<{ organizationId: number; saved: OrgFomSavedConfig }> = [];
  for (const row of rows) {
    const id = Number(row.key.slice(ORG_KEY_PREFIX.length));
    if (!Number.isFinite(id) || id <= 0) continue;
    try {
      out.push({ organizationId: id, saved: JSON.parse(row.value) as OrgFomSavedConfig });
    } catch {
      /* skip bad rows */
    }
  }
  return out;
}

let firstRun: NodeJS.Timeout | null = null;
let timer: NodeJS.Timeout | null = null;

/** (Re)starts the auto-sync timer: every configured org + legacy global config. */
export function scheduleFomSync(): void {
  if (firstRun) clearTimeout(firstRun);
  if (timer) clearInterval(timer);
  firstRun = timer = null;

  const tick = async () => {
    try {
      const orgs = await listOrgFomConfigs();
      for (const { organizationId, saved } of orgs) {
        const cfg = resolveOrgFomConfigForSync(organizationId, saved);
        const everySec =
          saved.intervalSeconds && saved.intervalSeconds > 0
            ? saved.intervalSeconds
            : cfg.intervalMinutes > 0
              ? cfg.intervalMinutes * 60
              : 0;
        if ((!cfg.reportUrl && !cfg.agentRelay) || everySec <= 0) continue;
        // Honour interval: skip while a run is active or still fresh.
        const [row] = await db
          .select({
            completedAt: integrationImportsTable.completedAt,
            status: integrationImportsTable.status,
            startedAt: integrationImportsTable.startedAt,
          })
          .from(integrationImportsTable)
          .where(
            and(
              eq(integrationImportsTable.organizationId, organizationId),
              eq(integrationImportsTable.integration, "fom"),
            ),
          )
          .orderBy(desc(integrationImportsTable.startedAt))
          .limit(1);
        if (row?.status === "running") continue;
        const finishedAt = row?.completedAt ?? row?.startedAt;
        if (finishedAt && Date.now() - new Date(finishedAt).getTime() < everySec * 1000) {
          continue;
        }
        await startFomSync({
          trigger: "auto",
          organizationId,
          config: cfg,
          startDate: orgStartDate(saved),
        }).catch((error) => logger.error({ err: error, organizationId }, "Org FOM auto sync failed"));
      }
      // Legacy global (platform) sync when no per-org configs drive the env host.
      const global = fomConfig();
      const seconds = Number(process.env.FOM_SYNC_INTERVAL_SEC) || 0;
      const everyMs = seconds > 0 ? seconds * 1000 : global.intervalMinutes * 60_000;
      if (global.reportUrl && everyMs > 0 && orgs.length === 0) {
        await startFomSync({ trigger: "auto" }).catch((error) =>
          logger.error({ err: error }, "Global FOM auto sync failed"),
        );
      }
    } catch (error) {
      logger.error({ err: error }, "FOM auto sync tick failed");
    }
  };

  // Poll often enough for 5-second org intervals (env can override).
  const envSec = Number(process.env.FOM_SYNC_INTERVAL_SEC || 0);
  const pollMs = envSec > 0 ? Math.max(5_000, envSec * 1000) : 5_000;
  firstRun = setTimeout(() => void tick(), 5_000);
  timer = setInterval(() => void tick(), pollMs);
  logger.info({ pollSeconds: pollMs / 1000 }, "FOM auto sync scheduler enabled");
}
