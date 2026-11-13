import { eq, like } from "drizzle-orm";
import { db, integrationSettingsTable } from "@workspace/db";
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
};

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

export async function saveOrgFomConfig(organizationId: number, value: OrgFomSavedConfig): Promise<void> {
  const json = JSON.stringify(value);
  const key = orgFomSettingsKey(organizationId);
  await db
    .insert(integrationSettingsTable)
    .values({ key, value: json })
    .onConflictDoUpdate({ target: integrationSettingsTable.key, set: { value: json, updatedAt: new Date() } });
  scheduleFomSync();
}

export async function orgFomConfigUpdatedAt(organizationId: number): Promise<Date | null> {
  const [row] = await db
    .select({ updatedAt: integrationSettingsTable.updatedAt })
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.key, orgFomSettingsKey(organizationId)))
    .limit(1);
  return row?.updatedAt ?? null;
}

/** Merge env defaults with org-saved settings into a runtime FomConfig. */
export function resolveOrgFomConfig(saved: OrgFomSavedConfig | null): FomConfig {
  const env = fomEnvConfig();
  if (!saved) return env;
  const merged = { ...env };
  for (const [key, value] of Object.entries(saved) as Array<[keyof OrgFomSavedConfig, unknown]>) {
    if (key === "startDate") continue;
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
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
        const cfg = resolveOrgFomConfig(saved);
        if (!cfg.reportUrl || cfg.intervalMinutes <= 0) continue;
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

  // Poll frequently enough for the tightest org interval; each org still self-gates via interval.
  const pollMs = Math.max(30_000, Number(process.env.FOM_SYNC_INTERVAL_SEC || 0) * 1000 || 60_000);
  firstRun = setTimeout(() => void tick(), 15_000);
  timer = setInterval(() => void tick(), pollMs);
  logger.info({ pollSeconds: pollMs / 1000 }, "FOM auto sync scheduler enabled");
}
