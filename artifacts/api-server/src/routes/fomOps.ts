import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { ensureOrgAgentToken } from "../lib/fomAgent";
import {
  loadOrgFomConfig,
  orgStartDate,
  resolveOrgFomConfigForSync,
  saveOrgFomConfig,
  type OrgFomSavedConfig,
} from "../lib/fomSettings";
import { fomSyncRunning, startFomSync } from "../lib/fomSync";
import { PUBLIC_APP_URL } from "../lib/ownerHost";

const router: IRouter = Router();

function isLocal(req: { ip?: string; socket?: { remoteAddress?: string } }): boolean {
  const raw = String(req.ip || req.socket?.remoteAddress || "");
  return (
    raw === "127.0.0.1" ||
    raw === "::1" ||
    raw.endsWith("127.0.0.1") ||
    raw === ":ffff:127.0.0.1"
  );
}

function opsTokenOk(req: Request): boolean {
  const expected = process.env.FOM_OPS_TOKEN?.trim();
  if (!expected) return false;
  const got =
    (typeof req.headers["x-fom-ops-token"] === "string" ? req.headers["x-fom-ops-token"] : "") ||
    (typeof req.body?.opsToken === "string" ? req.body.opsToken : "");
  if (!got || got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

function allowOps(req: Request): boolean {
  return isLocal(req) || opsTokenOk(req);
}

function platformUrl(req: Request): string {
  const env = PUBLIC_APP_URL();
  if (env && !/localhost|127\.0\.0\.1/i.test(env)) return env.replace(/\/+$/, "");
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0]?.trim() || "https";
  const host = (req.get("x-forwarded-host") || req.get("host") || "pharmxs.uz").split(",")[0]?.trim();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

/** FOM PC first-run: create agent token + PC-local REPORT config (no VPN). */
router.post("/fom/ops/bootstrap", async (req, res): Promise<void> => {
  if (!allowOps(req)) {
    res.status(403).json({ error: "Ruxsat yoʻq (localhost yoki FOM_OPS_TOKEN kerak)." });
    return;
  }
  const organizationId = Number(req.body?.organizationId ?? 0);
  if (!Number.isFinite(organizationId) || organizationId < 1) {
    res.status(400).json({ error: "organizationId kerak." });
    return;
  }
  const reportPort = Math.max(1, Number(req.body?.reportPort) || 8084);
  const startDate =
    typeof req.body?.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.startDate)
      ? req.body.startDate
      : "2025-01-01";
  const filialRaw = typeof req.body?.filialIds === "string" ? req.body.filialIds : "1";
  const filialIds = [...new Set(filialRaw.split(/[,;\s]+/).map((x: string) => x.trim()).filter(Boolean))];

  const prev = (await loadOrgFomConfig(organizationId)) ?? ({} as OrgFomSavedConfig);
  const token = await ensureOrgAgentToken(organizationId);
  const saved: OrgFomSavedConfig = {
    ...prev,
    reportUrl: `http://127.0.0.1:${reportPort}`,
    filialIds: filialIds.length ? filialIds : ["1"],
    // Continuous append into PHARMXS DB (upsert by FOM id).
    intervalMinutes: 15,
    intervalSeconds: 15 * 60,
    initialDays: 680,
    timeoutMs: 180_000,
    startDate,
    agentRelay: true,
    agentPort: reportPort,
    agentToken: token,
  };
  await saveOrgFomConfig(organizationId, saved);

  res.json({
    ok: true,
    organizationId,
    token,
    reportPort,
    platformUrl: platformUrl(req),
    startDate,
    message: "FOM PC lokal REPORT rejimiga sozlandi. VPN kerak emas.",
  });
});

async function startOrgSync(req: Request) {
  const organizationId = Number(req.body?.organizationId ?? 0);
  if (!Number.isFinite(organizationId) || organizationId < 1) {
    return { status: 400 as const, body: { error: "organizationId kerak." } };
  }
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = typeof req.body?.dateFrom === "string" ? req.body.dateFrom : "2025-01-01";
  const dateTo = typeof req.body?.dateTo === "string" ? req.body.dateTo : today;
  const saved = (await loadOrgFomConfig(organizationId)) ?? ({} as OrgFomSavedConfig);
  saved.agentRelay = true;
  if (!(saved.intervalMinutes && saved.intervalMinutes > 0) && !(saved.intervalSeconds && saved.intervalSeconds > 0)) {
    saved.intervalMinutes = 15;
    saved.intervalSeconds = 15 * 60;
  }
  await saveOrgFomConfig(organizationId, saved);
  const config = resolveOrgFomConfigForSync(organizationId, saved);
  const startDate = orgStartDate(saved);
  if (!config.reportUrl && !config.agentRelay) {
    return { status: 400 as const, body: { error: "FOM sozlanmagan — avval bootstrap." } };
  }
  if (fomSyncRunning(organizationId)) {
    return {
      status: 200 as const,
      body: { started: false, message: "Allaqachon bajarilmoqda.", running: true },
    };
  }
  const result = await startFomSync({
    from: new Date(dateFrom),
    to: new Date(dateTo),
    trigger: "manual",
    organizationId,
    config,
    startDate,
  });
  return {
    status: 200 as const,
    body: { ...result, running: fomSyncRunning(organizationId), dateFrom, dateTo, agentRelay: true },
  };
}

/** Localhost OR ops token — start dated sync (jobs go to FOM PC agent). */
router.post("/fom/ops/start-org-sync", async (req, res): Promise<void> => {
  if (!allowOps(req)) {
    res.status(403).json({ error: "Ruxsat yoʻq (localhost yoki FOM_OPS_TOKEN kerak)." });
    return;
  }
  const result = await startOrgSync(req);
  res.status(result.status).json(result.body);
});

export default router;
