// Imported before ./app: localAuth reads AUTH_MODE at module load, and the web app is always built in local mode.
process.env.AUTH_MODE ||= "local";
