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
  // Relay needs poll loop; hello-only means UI "connected" but no data.
  const poll = saved?.agentLastPollAt ? new Date(saved.agentLastPollAt) : null;
  const seen = saved?.agentLastSeenAt ? new Date(saved.agentLastSeenAt) : null;
  const pollOk = !!poll && Number.isFinite(poll.getTime()) && Date.now() - poll.getTime() < 3 * 60_000;
  const seenOk = !!seen && Number.isFinite(seen.getTime()) && Date.now() - seen.getTime() < 15 * 60_000;
  const online = pollOk || (seenOk && !saved?.agentRelay);
  return {
    tokenSet: Boolean(saved?.agentToken),
    online,
    machine: saved?.agentMachine ?? null,
    host: saved?.agentHost ?? null,
    port: saved?.agentPort ?? null,
    lastSeenAt: saved?.agentLastPollAt ?? saved?.agentLastSeenAt ?? null,
    reportListening: saved?.agentReportListening ?? null,
  };
}

export async function ensureOrgAgentToken(organizationId: number): Promise<string> {
  const existing = await loadOrgFomConfig(organizationId);
  if (existing?.agentToken?.trim()) return existing.agentToken.trim();
  return rotateOrgAgentToken(organizationId);
}

/** Drop token so the PC agent stops; company FOM data stays. */
export async function disconnectOrgAgent(organizationId: number): Promise<void> {
  const existing = (await loadOrgFomConfig(organizationId)) ?? {};
  const prev = existing.agentToken?.trim();
  if (prev) {
    await db.delete(integrationSettingsTable).where(eq(integrationSettingsTable.key, agentMapKey(prev)));
  }
  const {
    agentToken: _t,
    agentHost: _h,
    agentMachine: _m,
    agentLastSeenAt: _s,
    agentLastPollAt: _p,
    agentLocalIps: _ips,
    agentReportListening: _r,
    ...keep
  } = existing;
  await saveOrgFomConfig(organizationId, { ...keep, agentRelay: true });
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
  // Drop previous token + online markers; keep filial/startDate/port/relay.
  const {
    agentLastSeenAt: _seen,
    agentLastPollAt: _poll,
    agentToken: _oldTok,
    ...keep
  } = existing;
  await saveOrgFomConfig(organizationId, {
    ...keep,
    agentToken: token,
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
  /** Desktop agent build; 2+ can read dbo.ORG names via local SQL. */
  agentVersion?: number;
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

  const now = new Date().toISOString();
  const machine = input.machine?.trim() || existing.agentMachine;
  const listening = input.reportListening ?? existing.agentReportListening;
  const saved: OrgFomSavedConfig = {
    ...existing,
    reportUrl: reportUrl ?? existing.reportUrl,
    filialIds: existing.filialIds?.length ? existing.filialIds : [],
    intervalMinutes: existing.intervalMinutes && existing.intervalMinutes > 0 ? existing.intervalMinutes : 1,
    intervalSeconds: existing.intervalSeconds && existing.intervalSeconds > 0 ? existing.intervalSeconds : 5,
    initialDays: existing.initialDays ?? 365,
    timeoutMs: existing.timeoutMs && existing.timeoutMs > 0 ? Math.max(existing.timeoutMs, 600_000) : 600_000,
    startDate: existing.startDate ?? DEFAULT_FOM_START_DATE,
    agentToken: existing.agentToken,
    agentHost: host || existing.agentHost,
    agentPort: port,
    agentMachine: machine,
    agentLocalIps: input.localIps?.slice(0, 12) ?? existing.agentLocalIps,
    agentReportListening: listening,
    agentLastSeenAt: now,
    agentVersion: Number.isFinite(input.agentVersion) ? Math.trunc(input.agentVersion!) : existing.agentVersion,
    // Default: relay through pharmacy PC (cloud often cannot reach public IP / NAT).
    agentRelay: existing.agentRelay !== false,
  };

  const prevSeen = existing.agentLastSeenAt ? new Date(existing.agentLastSeenAt).getTime() : 0;
  const sameShape =
    existing.agentHost === saved.agentHost &&
    existing.agentPort === saved.agentPort &&
    existing.agentMachine === saved.agentMachine &&
    existing.agentReportListening === saved.agentReportListening &&
    existing.agentRelay === saved.agentRelay &&
    (existing.reportUrl ?? null) === (saved.reportUrl ?? null);
  // Heartbeat every ~1s from continuous agent — only persist every 45s unless shape changed.
  if (!sameShape || !Number.isFinite(prevSeen) || Date.now() - prevSeen > 45_000) {
    await saveOrgFomConfig(organizationId, saved, { reschedule: !sameShape });
  }
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
  // Worker gets real platform/token baked in; install wrapper still uses __ markers.
  return fomAgentInstallScriptTemplate({ platform, token })
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
    "$c=(Invoke-WebRequest -Uri $u -UseBasicParsing).Content;",
    "[IO.File]::WriteAllText($p,$c,(New-Object System.Text.UTF8Encoding $true));",
    "& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p",
  ].join(" ");
}

/**
 * CMD one-liner: downloads install.bat then runs it (UAC elevates inside the bat).
 */
export function buildFomAgentBatOneLiner(opts: { platformUrl: string; token: string }): string {
  const platform = opts.platformUrl.replace(/\/+$/, "");
  const token = opts.token.replace(/"/g, "");
  const url = `${platform}/api/fom/agent/install.bat?token=${token}`;
  return [
    `curl.exe -L -o "%TEMP%\\pharmxs-fom-agent.bat" "${url}"`,
    `&& "%TEMP%\\pharmxs-fom-agent.bat"`,
  ].join(" ");
}

/**
 * Admin bat: stop watchdog/tasks/processes and delete C:\\ProgramData\\PHARMXS.
 * Use when the agent "comes back" after deleting files.
 */
export function buildFomAgentUninstallBatScript(): string {
  return [
    "@echo off",
    "setlocal EnableExtensions",
    "title PHARMXS FOM Agent - OCHIRISH",
    "",
    "net session >nul 2>&1",
    "if not \"%errorLevel%\"==\"0\" (",
    "  echo Admin huquq so'ralmoqda...",
    "  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Start-Process -FilePath '%~f0' -Verb RunAs\"",
    "  exit /b",
    ")",
    "",
    "echo === PHARMXS agentni to'liq o'chirish ===",
    "echo.",
    "",
    "echo [1/4] Scheduled Task o'chirilmoqda...",
    "schtasks /Delete /TN \"PHARMXS-FOM-Agent\" /F >nul 2>&1",
    "schtasks /Delete /TN \"PHARMXS-FOM-AgentWatch\" /F >nul 2>&1",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Unregister-ScheduledTask -TaskName 'PHARMXS-FOM-Agent' -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'PHARMXS-FOM-AgentWatch' -Confirm:$false -ErrorAction SilentlyContinue\" >nul 2>&1",
    "",
    "echo [2/4] Jarayonlar to'xtatilmoqda...",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^",
    "  \"Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and ( $_.CommandLine -like '*fom-agent-worker*' -or $_.CommandLine -like '*fom-agent-watch*' -or $_.CommandLine -like '*pharmxs-fom-agent*' -or $_.CommandLine -like '*PHARMXS\\fom-agent*' ) } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }\"",
    "",
    "echo [3/4] Firewall qoidalari...",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'PHARMXS FOM*' } | Remove-NetFirewallRule -ErrorAction SilentlyContinue\" >nul 2>&1",
    "",
    "echo [4/4] Fayllar o'chirilmoqda...",
    "rd /s /q \"%ProgramData%\\PHARMXS\" >nul 2>&1",
    "del /f /q \"%TEMP%\\pharmxs-fom-agent.ps1\" >nul 2>&1",
    "del /f /q \"%TEMP%\\pharmxs-fom-agent.bat\" >nul 2>&1",
    "del /f /q \"%TEMP%\\pharmxs-fom-uninstall.bat\" >nul 2>&1",
    "",
    "if exist \"%ProgramData%\\PHARMXS\" (",
    "  echo [!] Ba'zi fayllar band - kompyuterni qayta yoqib, yana ishga tushiring.",
    ") else (",
    "  echo [OK] Agent to'liq o'chirildi. Endi o'zi qayta chiqmaydi.",
    ")",
    "echo.",
    "pause",
    "endlocal",
    "",
  ].join("\r\n");
}

/**
 * Self-elevating .bat: Admin UAC -> download install.ps1 -> run agent setup.
 * ASCII only (cmd.exe code page safe). One-click connect for each company PC.
 */
export function buildFomAgentBatScript(opts: { platformUrl: string; token: string }): string {
  const platform = opts.platformUrl.replace(/\/+$/, "");
  const token = opts.token.replace(/[%&^<>|"]/g, "");
  const ps1Url = `${platform}/api/fom/agent/install.ps1?token=${token}`;
  return [
    "@echo off",
    "setlocal EnableExtensions",
    "title PHARMXS FOM ulanish",
    "cd /d \"%TEMP%\"",
    "",
    "net session >nul 2>&1",
    "if not \"%errorLevel%\"==\"0\" (",
    "  echo Admin huquq so'ralmoqda...",
    "  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Start-Process -FilePath '%~f0' -Verb RunAs\"",
    "  exit /b",
    ")",
    "",
    "echo === PHARMXS: FOM kompyuter ulanishi ===",
    "echo 01.01.2025 dan bugungacha + avtomatik yangilanish",
    "echo Platform: " + platform,
    "echo.",
    "",
    "set \"PHARMXS_PS1=%TEMP%\\pharmxs-fom-agent.ps1\"",
    "echo Skript yuklanmoqda...",
    `curl.exe -fsSL -o "%PHARMXS_PS1%" "${ps1Url}"`,
    "if errorlevel 1 (",
    "  echo curl ishlamadi - PowerShell orqali yuklanmoqda...",
    "  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^",
    `    \"$u='${ps1Url}'; $p=$env:TEMP+'\\pharmxs-fom-agent.ps1'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $c=(Invoke-WebRequest -Uri $u -UseBasicParsing).Content; [IO.File]::WriteAllText($p,$c,(New-Object System.Text.UTF8Encoding $true))\"`,
    "  if errorlevel 1 (",
    "    echo [X] Skript yuklanmadi",
    "    pause",
    "    exit /b 1",
    "  )",
    ")",
    "",
    "echo Agent ishga tushirilmoqda...",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%PHARMXS_PS1%\"",
    "set \"ERR=%ERRORLEVEL%\"",
    "echo.",
    "if not \"%ERR%\"==\"0\" (",
    "  echo [X] Xato kod: %ERR%",
    "  pause",
    "  exit /b %ERR%",
    ")",
    "echo [OK] Tayyor. Bu oynani yopishingiz mumkin.",
    "pause",
    "endlocal",
    "",
  ].join("\r\n");
}

