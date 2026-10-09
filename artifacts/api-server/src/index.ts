import app from "./app";
import { logger } from "./lib/logger";
import { ensureBootstrapAdmin, localAuthEnabled } from "./lib/localAuth";
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
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

await loadFomSettings();
scheduleFomSync();
