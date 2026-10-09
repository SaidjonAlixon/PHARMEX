import "./vercel-env";
import type { IncomingMessage, ServerResponse } from "node:http";

const missing = ["DATABASE_URL", "SESSION_SECRET"].filter((key) => !process.env[key]);

// The app is loaded lazily so a missing setting produces a readable answer instead of a crashed function.
const boot = missing.length
  ? null
  : (async () => {
      const [{ default: app }, { loadFomSettings }] = await Promise.all([import("./app"), import("./lib/fomSettings")]);
      // Vercel's edge sets X-Forwarded-For / -Proto itself, so req.ip and req.protocol come from it.
      app.set("trust proxy", true);
      await loadFomSettings();
      return app;
    })();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!boot) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: `Server sozlanmagan: Vercel → Settings → Environment Variables ga ${missing.join(", ")} qoʻshing va Redeploy qiling.`,
      }),
    );
    return;
  }
  const app = await boot;
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
