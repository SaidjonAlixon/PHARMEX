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
  const config = fomConfig();
  // FOM_SYNC_INTERVAL_SEC allows sub-minute polling; the saved / API setting is whole minutes.
  const seconds = Number(process.env.FOM_SYNC_INTERVAL_SEC) || 0;
  const everyMs = seconds > 0 ? seconds * 1000 : config.intervalMinutes * 60_000;
  if (!config.reportUrl || everyMs <= 0) {
    logger.info("FOM auto sync disabled");
    return;
  }
  const tick = () =>
    startFomSync({ trigger: "auto" }).catch((error) =>
      logger.error({ err: error }, "FOM auto sync failed to start"),
    );
  firstRun = setTimeout(tick, 15_000);
  timer = setInterval(tick, everyMs);
  logger.info({ seconds: everyMs / 1000 }, "FOM auto sync enabled");
}
