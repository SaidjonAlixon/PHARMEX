#!/usr/bin/env node
/**
 * PHARMEX FOM Agent — runs on the pharmacy PC next to F-APTEKA.
 * Pulls REPORT.exe from localhost and pushes each report to PHARMEX cloud.
 *
 * Usage:
 *   node agent.mjs              # loop (INTERVAL_MIN)
 *   node agent.mjs --once       # one full sync then exit
 *   node agent.mjs --test       # only ping cloud + local REPORT.exe
 */
import { readFileSync, appendFileSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPORTS = {
  organizations: { id: 189, dated: false, label: "Tashkilotlar" },
  catalog: { id: 188, dated: false, label: "Tovarlar" },
  stock: { id: 6, dated: false, label: "Qoldiqlar" },
  purchases: { id: 11, dated: true, label: "Kirim" },
  supplierReturns: { id: 12, dated: true, label: "Qaytarish" },
  writeOffs: { id: 3, dated: true, label: "Hisobdan chiqarish" },
  retailSales: { id: 14, dated: true, label: "Chakana savdo" },
  insuranceSales: { id: 15, dated: true, label: "Sugurta savdo" },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = process.pkg ? dirname(process.execPath) : __dirname;
const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const testOnly = args.has("--test");

function parseIni(text) {
  const out = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) {
      section = sec[1].toUpperCase();
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0 || !section) continue;
    out[section][line.slice(0, eq).trim().toUpperCase()] = line.slice(eq + 1).trim();
  }
  return out;
}

function loadConfig() {
  const path = [join(root, "config.ini"), join(process.cwd(), "config.ini")].find((p) => existsSync(p));
  if (!path) {
    const example = join(root, "config.example.ini");
    if (existsSync(example)) {
      copyFileSync(example, join(root, "config.ini"));
      throw new Error(`config.ini yaratildi (${join(root, "config.ini")}). TOKEN ni to'ldiring va qayta ishga tushiring.`);
    }
    throw new Error("config.ini topilmadi. config.example.ini dan nusxa oling.");
  }
  const ini = parseIni(readFileSync(path, "utf8"));
  const cloud = ini.CLOUD ?? {};
  const fom = ini.FOM ?? {};
  const agent = ini.AGENT ?? {};
  const url = (cloud.URL || "").replace(/\/+$/, "");
  const token = cloud.TOKEN || "";
  if (!url || !token) throw new Error("config.ini: [CLOUD] URL va TOKEN majburiy.");
  return {
    cloudUrl: url,
    token,
    reportUrl: (fom.REPORT_URL || "http://127.0.0.1:8084").replace(/\/+$/, ""),
    filialIds: [...new Set((fom.FILIAL_IDS || "1").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean))],
    initialDays: Math.max(1, Number(fom.INITIAL_DAYS) || 90),
    intervalMin: Math.max(0, Number(fom.INTERVAL_MIN) || 5),
    timeoutMs: Math.max(5, Number(fom.TIMEOUT_SEC) || 120) * 1000,
    logFile: resolve(root, agent.LOG || "agent.log"),
    configPath: path,
  };
}

function log(cfg, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    appendFileSync(cfg.logFile, line + "\n", "utf8");
  } catch {
    // ignore log write errors
  }
}

function fomDate(date) {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}

function dayUtc(daysAgo = 0) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

function windows(from, to) {
  const out = [];
  let cursor = new Date(from);
  while (cursor <= to) {
    const end = new Date(Math.min(cursor.getTime() + 30 * 86400000, to.getTime()));
    out.push([new Date(cursor), end]);
    cursor = new Date(end.getTime() + 86400000);
  }
  return out;
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeoutMs ?? 120000) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function fetchReport(cfg, reportId, filialId, from, to) {
  const params = new URLSearchParams({
    pDateFrom: fomDate(from),
    pDateTo: fomDate(to),
    pFilial_id: filialId,
    pReport_id: String(reportId),
  });
  const url = `${cfg.reportUrl}/P_GetReport_XML?${params}`;
  try {
    const { ok, status, text } = await fetchText(url, { timeoutMs: cfg.timeoutMs });
    if (!ok) throw new Error(`REPORT.exe ${status}: ${text.slice(0, 160)}`);
    if (!text.trim().startsWith("<") && !text.includes("<")) {
      throw new Error(`REPORT.exe XML emas: ${text.trim().slice(0, 120)}`);
    }
    return text;
  } catch (error) {
    const msg = error?.cause?.code || error?.code || error?.message || String(error);
    if (/ECONNREFUSED|fetch failed|Connect/i.test(String(msg))) {
      throw new Error(
        `REPORT.exe topilmadi (${cfg.reportUrl}). FOM texnigi SERVICEREPORTS ni 8084 portda o'rnatishi kerak.`,
      );
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function pushReport(cfg, report, filialId, xml) {
  const url = `${cfg.cloudUrl}/api/fom/agent/${encodeURIComponent(cfg.token)}/report`;
  const { ok, status, text } = await fetchText(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Token": cfg.token },
    body: JSON.stringify({ report, filialId, xml }),
    timeoutMs: Math.max(cfg.timeoutMs, 180000),
  });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // plain text error
  }
  if (!ok) throw new Error(json?.error || `PHARMEX ${status}: ${text.slice(0, 200)}`);
  return json;
}

async function pingCloud(cfg) {
  const url = `${cfg.cloudUrl}/api/fom/agent/${encodeURIComponent(cfg.token)}/ping`;
  const { ok, status, text } = await fetchText(url, {
    headers: { "X-Token": cfg.token },
    timeoutMs: 30000,
  });
  if (!ok) throw new Error(`PHARMEX ping ${status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function testLocal(cfg) {
  const today = dayUtc(0);
  await fetchReport(cfg, REPORTS.organizations.id, cfg.filialIds[0] || "1", today, today);
}

async function syncOnce(cfg) {
  const to = dayUtc(0);
  const from = dayUtc(cfg.initialDays);
  let totalImported = 0;
  let errors = 0;

  for (const [key, def] of Object.entries(REPORTS)) {
    for (const filial of cfg.filialIds) {
      try {
        if (!def.dated) {
          log(cfg, `→ ${def.label} (filial ${filial})…`);
          const xml = await fetchReport(cfg, def.id, filial, to, to);
          const result = await pushReport(cfg, key, filial, xml);
          totalImported += result.imported ?? 0;
          log(cfg, `  ✓ ${result.rows ?? 0} qator → ${result.imported ?? 0} import`);
        } else {
          for (const [start, end] of windows(from, to)) {
            log(cfg, `→ ${def.label} (filial ${filial}, ${fomDate(start)}–${fomDate(end)})…`);
            const xml = await fetchReport(cfg, def.id, filial, start, end);
            const result = await pushReport(cfg, key, filial, xml);
            totalImported += result.imported ?? 0;
            log(cfg, `  ✓ ${result.rows ?? 0} qator → ${result.imported ?? 0} import`);
          }
        }
      } catch (error) {
        errors += 1;
        log(cfg, `  ✗ ${error instanceof Error ? error.message : String(error)}`);
        if (/REPORT\.exe topilmadi/.test(String(error))) throw error;
      }
    }
  }
  return { totalImported, errors };
}

async function main() {
  console.log("══════════════════════════════════════");
  console.log("  PHARMEX FOM Agent  ·  IFOR PHARMA");
  console.log("══════════════════════════════════════");
  const cfg = loadConfig();
  log(cfg, `Config: ${cfg.configPath}`);
  log(cfg, `Cloud:  ${cfg.cloudUrl}`);
  log(cfg, `REPORT: ${cfg.reportUrl}`);
  log(cfg, `Filial: ${cfg.filialIds.join(", ")}`);

  log(cfg, "PHARMEX bulutini tekshiruv…");
  const ping = await pingCloud(cfg);
  log(cfg, `Bulut OK (${ping.reports?.length ?? 0} hisobot turi).`);

  log(cfg, "Lokal REPORT.exe ni tekshiruv…");
  try {
    await testLocal(cfg);
    log(cfg, "REPORT.exe OK.");
  } catch (error) {
    log(cfg, String(error instanceof Error ? error.message : error));
    if (testOnly) process.exit(1);
    log(cfg, "REPORT.exe paydo bo'lguncha kutamiz (har 60 soniyada qayta urinish).");
  }

  if (testOnly) {
    log(cfg, "Test yakunlandi.");
    return;
  }

  const run = async () => {
    try {
      await testLocal(cfg);
      const result = await syncOnce(cfg);
      log(cfg, `Sinxron yakunlandi: ${result.totalImported} yozuv, ${result.errors} xato.`);
      writeFileSync(join(root, "last-ok.txt"), new Date().toISOString(), "utf8");
    } catch (error) {
      log(cfg, `Sinxron to'xtadi: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await run();
  if (once || cfg.intervalMin <= 0) return;

  const ms = cfg.intervalMin * 60_000;
  log(cfg, `Avto-sinxron har ${cfg.intervalMin} daqiqada.`);
  setInterval(() => {
    void run();
  }, ms);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
