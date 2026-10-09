import type { IncomingMessage, ServerResponse } from "node:http";
import app from "./app";
import { loadFomSettings } from "./lib/fomSettings";

// Vercel's edge sets X-Forwarded-For / -Proto itself, so req.ip and req.protocol come from it.
app.set("trust proxy", true);

const ready = loadFomSettings();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ready;
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
