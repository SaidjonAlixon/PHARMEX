import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, integrationSettingsTable } from "@workspace/db";
import { fomAgentInstallScriptTemplate } from "./fomAgentInstallScript";
import {
  DEFAULT_FOM_START_DATE,
  loadOrgFomConfig,
  orgStartDate,
  resolveOrgFomConfig,
  saveOrgFomConfig,
  type OrgFomSavedConfig,
} from "./fomSettings";

const AGENT_MAP_PREFIX = "fom_agent_token:";

export type FomAgentInfo = {
  tokenSet: boolean;
  online: boolean;
  machine: string | null;
  host: string | null;
  port: number | null;
  lastSeenAt: string | null;
  reportListening: boolean | null;
};

function agentMapKey(token: string) {
  return `${AGENT_MAP_PREFIX}${token}`;
}

function newAgentToken() {
  return `pxa_${randomBytes(24).toString("base64url")}`;
}

function sameToken(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function agentInfoFromSaved(saved: OrgFomSavedConfig | null): FomAgentInfo {
  const last = saved?.agentLastSeenAt ? new Date(saved.agentLastSeenAt) : null;
  const online = !!last && Number.isFinite(last.getTime()) && Date.now() - last.getTime() < 15 * 60_000;
  return {
    tokenSet: Boolean(saved?.agentToken),
    online,
    machine: saved?.agentMachine ?? null,
    host: saved?.agentHost ?? null,
    port: saved?.agentPort ?? null,
    lastSeenAt: saved?.agentLastSeenAt ?? null,
    reportListening: saved?.agentReportListening ?? null,
  };
}

export async function ensureOrgAgentToken(organizationId: number): Promise<string> {
  const existing = await loadOrgFomConfig(organizationId);
  if (existing?.agentToken?.trim()) return existing.agentToken.trim();
  return rotateOrgAgentToken(organizationId);
}

export async function rotateOrgAgentToken(organizationId: number): Promise<string> {
  const existing = (await loadOrgFomConfig(organizationId)) ?? {};
  const prev = existing.agentToken?.trim();
  if (prev) {
    await db.delete(integrationSettingsTable).where(eq(integrationSettingsTable.key, agentMapKey(prev)));
  }
  const token = newAgentToken();
  await db
    .insert(integrationSettingsTable)
    .values({ key: agentMapKey(token), value: String(organizationId) })
    .onConflictDoUpdate({
      target: integrationSettingsTable.key,
      set: { value: String(organizationId), updatedAt: new Date() },
    });
  await saveOrgFomConfig(organizationId, {
    ...existing,
    agentToken: token,
    // keep connection fields; clear stale online marker until next hello
    agentLastSeenAt: undefined,
  });
  return token;
}

export async function resolveOrgByAgentToken(token: string): Promise<number | null> {
  const clean = token.trim();
  if (!clean) return null;
  const [row] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.key, agentMapKey(clean)))
    .limit(1);
  if (row) {
    const id = Number(row.value);
    if (Number.isFinite(id) && id > 0) {
      const saved = await loadOrgFomConfig(id);
      if (saved?.agentToken && sameToken(saved.agentToken, clean)) return id;
    }
  }
  // Fallback scan (legacy rows without map key)
  const { listOrgFomConfigs } = await import("./fomSettings");
  for (const { organizationId, saved } of await listOrgFomConfigs()) {
    if (saved.agentToken && sameToken(saved.agentToken, clean)) {
      await db
        .insert(integrationSettingsTable)
        .values({ key: agentMapKey(clean), value: String(organizationId) })
        .onConflictDoUpdate({
          target: integrationSettingsTable.key,
          set: { value: String(organizationId), updatedAt: new Date() },
        });
      return organizationId;
    }
  }
  return null;
}

export type AgentHelloInput = {
  token: string;
  host?: string;
  port?: number;
  machine?: string;
  localIps?: string[];
  reportListening?: boolean;
  protocol?: "http" | "https";
};

export async function applyAgentHello(input: AgentHelloInput): Promise<{
  organizationId: number;
  saved: OrgFomSavedConfig;
  configUrl: string | null;
}> {
  const organizationId = await resolveOrgByAgentToken(input.token);
  if (organizationId == null) throw new Error("Agent token notoʻgʻri.");

  const existing = (await loadOrgFomConfig(organizationId)) ?? {};
  let port = 8084;
  if (input.port && Number.isFinite(input.port) && input.port > 0 && input.port <= 65535) {
    port = Math.trunc(input.port);
  } else if (existing.agentPort && existing.agentPort > 0) {
    port = existing.agentPort;
  } else if (existing.reportUrl) {
    try {
      port = Number(new URL(existing.reportUrl).port) || 8084;
    } catch {
      port = 8084;
    }
  }
  const protocol = input.protocol === "https" ? "https" : "http";
  const host = (input.host?.trim() || existing.agentHost || "").replace(/^https?:\/\//i, "").split("/")[0]?.split(":")[0] ?? "";
  const reportUrl = host ? `${protocol}://${host}:${port}` : existing.reportUrl ?? null;

  const saved: OrgFomSavedConfig = {
    ...existing,
    reportUrl: reportUrl ?? existing.reportUrl,
    filialIds: existing.filialIds?.length ? existing.filialIds : [],
    intervalMinutes: existing.intervalMinutes && existing.intervalMinutes > 0 ? existing.intervalMinutes : 5,
    initialDays: existing.initialDays ?? 365,
    timeoutMs: existing.timeoutMs ?? 120_000,
    startDate: existing.startDate ?? DEFAULT_FOM_START_DATE,
    agentToken: existing.agentToken,
    agentHost: host || existing.agentHost,
    agentPort: port,
    agentMachine: input.machine?.trim() || existing.agentMachine,
    agentLocalIps: input.localIps?.slice(0, 12) ?? existing.agentLocalIps,
    agentReportListening: input.reportListening ?? existing.agentReportListening,
    agentLastSeenAt: new Date().toISOString(),
    // Default: relay through pharmacy PC (cloud often cannot reach public IP / NAT).
    agentRelay: existing.agentRelay !== false,
  };
  await saveOrgFomConfig(organizationId, saved);
  return { organizationId, saved, configUrl: reportUrl };
}

/** PowerShell that pharmacy admin runs once (firewall, register, schedule). */
export function buildFomAgentInstallScript(opts: {
  platformUrl: string;
  token: string;
  preferredPort?: number | null;
}): string {
  const platform = opts.platformUrl.replace(/\/+$/, "");
  const token = opts.token.replace(/'/g, "''");
  const port = opts.preferredPort && opts.preferredPort > 0 ? opts.preferredPort : 8084;
  return fomAgentInstallScriptTemplate()
    .replaceAll("__PLATFORM__", platform)
    .replaceAll("__TOKEN__", token)
    .replaceAll("__PORT__", String(port));
}

/**
 * Single-line paste for Admin PowerShell (avoids `>>` multi-line trap).
 * Downloads the full script by agent token, then runs it.
 */
export function buildFomAgentOneLiner(opts: { platformUrl: string; token: string }): string {
  const platform = opts.platformUrl.replace(/\/+$/, "");
  const token = opts.token.replace(/'/g, "''");
  return [
    "$ErrorActionPreference='Stop';",
    `$u='${platform}/api/fom/agent/install.ps1?token=${token}';`,
    "$p=Join-Path $env:TEMP 'pharmxs-fom-agent.ps1';",
    "(Invoke-WebRequest -Uri $u -UseBasicParsing).Content | Set-Content -Path $p -Encoding UTF8;",
    "& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p",
  ].join(" ");
}

