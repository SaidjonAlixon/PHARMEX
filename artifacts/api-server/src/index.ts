import app from "./app";
import { logger } from "./lib/logger";
import { ensureBootstrapAdmin, ensurePlatformAdminEmail, localAuthEnabled } from "./lib/localAuth";
import { loadFomSettings, scheduleFomSync } from "./lib/fomSettings";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (localAuthEnabled) {
  await ensureBootstrapAdmin();
  await ensurePlatformAdminEmail();
}

const listenHost = (process.env.LISTEN_HOST || "127.0.0.1").trim() || "127.0.0.1";

app.listen(port, listenHost, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host: listenHost }, "Server listening");
});

await loadFomSettings();
scheduleFomSync();
