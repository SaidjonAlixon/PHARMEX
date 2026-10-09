import { eq } from "drizzle-orm";
import { db, integrationSettingsTable } from "@workspace/db";
import { logger } from "./logger";
import { fomConfig, setSavedFomConfig, type FomSavedConfig } from "./fomClient";
import { startFomSync } from "./fomSync";

const SETTINGS_KEY = "fom_config";

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

let firstRun: NodeJS.Timeout | null = null;
let timer: NodeJS.Timeout | null = null;

/** (Re)starts the auto-sync timer from the current config. */
export function scheduleFomSync(): void {
  if (firstRun) clearTimeout(firstRun);
  if (timer) clearInterval(timer);
  firstRun = timer = null;
  if (process.env.VERCEL) {
    logger.info("FOM auto sync is not available on Vercel (no long-running process)");
    return;
  }
  const config = fomConfig();
  if (!config.reportUrl || config.intervalMinutes <= 0) {
    logger.info("FOM auto sync disabled");
    return;
  }
  const tick = () =>
    startFomSync({ trigger: "auto" }).catch((error) =>
      logger.error({ err: error }, "FOM auto sync failed to start"),
    );
  firstRun = setTimeout(tick, 15_000);
  timer = setInterval(tick, config.intervalMinutes * 60_000);
  logger.info({ minutes: config.intervalMinutes }, "FOM auto sync enabled");
}
