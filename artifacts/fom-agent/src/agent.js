/**
 * PHARMXS FOM Agent — small local desktop connector for pharmacy PCs.
 * No PowerShell required: UI + REPORT relay + auto-start.
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFile } = require("child_process");
const { URL } = require("url");

const UI_PORT = Number(process.env.PHARMXS_AGENT_UI_PORT) || 17885;
const DEFAULT_PLATFORM = "https://pharmxs.uz";
const DATA_DIR = path.join(process.env.ProgramData || process.env.APPDATA || os.tmpdir(), "PHARMXS");
const CONFIG_PATH = path.join(DATA_DIR, "agent.json");
const LOG_PATH = path.join(DATA_DIR, "agent-desktop.log");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  try {
    ensureDir();
    fs.appendFileSync(LOG_PATH, msg + "\n", "utf8");
  } catch {}
  if (process.stdout.isTTY) console.log(msg);
}

function readConfig() {
  try {
    ensureDir();
    if (!fs.existsSync(CONFIG_PATH)) return { platform: DEFAULT_PLATFORM, token: "", reportPort: 8084 };
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return {
      platform: String(raw.platform || DEFAULT_PLATFORM).replace(/\/+$/, ""),
      token: String(raw.token || "").trim(),
      reportPort: Number(raw.reportPort) > 0 ? Number(raw.reportPort) : 8084,
      autostart: Boolean(raw.autostart),
    };
  } catch {
    return { platform: DEFAULT_PLATFORM, token: "", reportPort: 8084 };
  }
}

function writeConfig(cfg) {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

function requestJson(method, urlStr, body, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(payload ? { "Content-Length": payload.length } : {}),
          Accept: "application/json",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { raw: text };
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(data.message || data.error || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(data);
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function getBuffer(urlStr, timeoutMs = 900_000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`REPORT HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("REPORT timeout"));
    });
  });
}

function listeningPorts() {
  return new Promise((resolve) => {
    execFile("netstat", ["-ano", "-p", "tcp"], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) return resolve([]);
      const ports = new Set();
      for (const line of String(stdout).split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const m = line.match(/:(\d+)\s/);
        if (m) ports.add(Number(m[1]));
      }
      resolve([...ports]);
    });
  });
}

async function detectReportPort(preferred = 8084) {
  const ports = await listeningPorts();
  if (ports.includes(preferred)) return preferred;
  for (const cand of [8084, 8080, 8085, 8090, 8081, 8082]) {
    if (ports.includes(cand)) return cand;
  }
  return preferred;
}

async function isPortListening(port) {
  const ports = await listeningPorts();
  return ports.includes(Number(port));
}

async function publicIp() {
  try {
    const data = await requestJson("GET", "https://api.ipify.org?format=json", null, 8000);
    return data.ip || null;
  } catch {
    return null;
  }
}

function localIps() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) out.push(item.address);
    }
  }
  return out.slice(0, 12);
}

function enableAutostart() {
  if (process.platform !== "win32") return { ok: false, message: "Faqat Windows." };
  const exePath = process.execPath;
  const script = process.pkg
    ? `"${exePath}"`
    : `"${process.execPath}" "${path.resolve(__dirname, "agent.cjs")}"`;
  // Prefer Startup folder shortcut via powershell-less: write a .cmd in Startup that launches exe hidden via wscript? 
  // Use registry Run key with reg.exe
  return new Promise((resolve) => {
    const value = process.pkg ? `"${exePath}"` : `"${process.execPath}" "${path.join(__dirname, "agent.cjs")}"`;
    execFile(
      "reg.exe",
      ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "PHARMXS-FOM-Agent", "/t", "REG_SZ", "/d", value, "/f"],
      { windowsHide: true },
      (err) => {
        if (err) resolve({ ok: false, message: "Avto-start yozilmadi: " + err.message });
        else {
          const cfg = readConfig();
          cfg.autostart = true;
          writeConfig(cfg);
          resolve({ ok: true, message: "Windows bilan birga avtomatik ishga tushadi." });
        }
      },
    );
  });
}

function disableAutostart() {
  if (process.platform !== "win32") return Promise.resolve();
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "PHARMXS-FOM-Agent", "/f"],
      { windowsHide: true },
      () => resolve(),
    );
  });
}

function openUi() {
  const url = `http://127.0.0.1:${UI_PORT}/`;
  if (process.platform === "win32") {
    const edge = path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe");
    const edge2 = path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe");
    const chrome = path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe");
    const chrome2 = path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe");
    const bin = [edge2, edge, chrome2, chrome].find((p) => p && fs.existsSync(p));
    if (bin) {
      spawn(bin, [`--app=${url}`, "--new-window", `--window-size=460,720`], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return;
    }
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
}

function uiHtml() {
  try {
    // eslint-disable-next-line import/no-unresolved
    const embedded = require("./_embed_ui.js");
    if (typeof embedded === "string" && embedded.includes("<html")) return embedded;
  } catch {}
  const candidates = [
    path.join(__dirname, "ui.html"),
    path.join(__dirname, "..", "src", "ui.html"),
    path.join(path.dirname(process.execPath), "ui.html"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {}
  }
  return "<h1>UI topilmadi</h1>";
}

let latestLive = {
  online: false,
  platformOnline: false,
  companyName: null,
  message: "Ishga tushmoqda…",
  reportPort: 8084,
  reportListening: false,
  sync: { running: false, percent: 0, message: "—", totals: { branches: 0, products: 0, purchases: 0, sales: 0 } },
};
let stopFlag = false;
let loopStarted = false;

async function refreshLocalFom(cfg) {
  const port = await detectReportPort(cfg.reportPort || 8084);
  cfg.reportPort = port;
  const listening = await isPortListening(port);
  latestLive.reportPort = port;
  latestLive.reportListening = listening;
  return { port, listening };
}

/** Escape XML attribute text. */
function xmlAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Prefer pharmacy DBs; NGLOBAL often only holds shared refs. */
const SQL_DB_CANDIDATES = ["NAPTSKLAD", "NGLOBAL", "NAptSklad", "NAPTEKA", "NAptSkladBase"];

function collectSqlConfigFiles() {
  const roots = [
    "D:\\ServiceReports",
    "C:\\ServiceReports",
    "C:\\SERVICEREPORTS",
    "E:\\ServiceReports",
    "C:\\F-APTEKA",
    "C:\\FAPTEKA",
    "C:\\FOM",
    "C:\\Program Files\\F-APTEKA",
    "C:\\Program Files (x86)\\F-APTEKA",
    "C:\\Program Files\\ServiceReports",
    "C:\\Program Files (x86)\\ServiceReports",
    process.env.ProgramData || "",
    os.homedir(),
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "Documents"),
    path.dirname(process.execPath),
    process.cwd(),
  ].filter(Boolean);
  // Any fixed drive:\ServiceReports (D: is the live IFOR install).
  try {
    for (const letter of "CDEFGHIJ") {
      roots.push(`${letter}:\\ServiceReports`);
      roots.push(`${letter}:\\F-APTEKA`);
      roots.push(`${letter}:\\FOM`);
    }
  } catch {}
  const names = [
    "ServiceReports.ini",
    "ServiceReports.udl",
    "SETUP.ini",
    "setup.ini",
    "CONNECT.ini",
    "REPORT.ini",
    "sql-config.json",
  ];
  const found = [];
  const push = (p) => {
    try {
      if (p && fs.existsSync(p) && !found.includes(p)) found.push(p);
    } catch {}
  };
  for (const root of roots) {
    for (const name of names) push(path.join(root, name));
    try {
      for (const ent of fs.readdirSync(root, { withFileTypes: true }).slice(0, 120)) {
        if (!ent.isDirectory()) continue;
        for (const name of names) push(path.join(root, ent.name, name));
      }
    } catch {}
  }
  // Also: folder of a running ServiceReports.exe (via WMIC-less dir probe of common Desktop copies).
  try {
    const desk = path.join(os.homedir(), "Desktop");
    for (const ent of fs.readdirSync(desk, { withFileTypes: true }).slice(0, 80)) {
      if (!ent.isDirectory()) continue;
      for (const name of names) push(path.join(desk, ent.name, name));
    }
  } catch {}
  return found.slice(0, 40);
}

function parseIniConnect(text, source) {
  // Only read [Connect] / [CONNECT] block so Host=http://… is not mistaken for SQL server.
  const connectBlock =
    text.match(/\[Connect\]([\s\S]*?)(?=\n\[|$)/i)?.[1] ||
    text.match(/\[CONNECTION\]([\s\S]*?)(?=\n\[|$)/i)?.[1] ||
    text;
  const grab = (keys) => {
    for (const key of keys) {
      const m = connectBlock.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "im"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
    return "";
  };
  let server = grab(["SERVER", "SQLSERVER", "Data Source", "DATA SOURCE"]);
  // Never treat http(s) REPORT URL as SQL host.
  if (/^https?:\/\//i.test(server)) server = "localhost";
  const database = grab(["BASE", "DATABASE", "DB", "Initial Catalog", "INITIAL CATALOG"]);
  const user = grab(["USER", "UID", "LOGIN", "User ID", "USER ID"]);
  const password = grab(["PASSWORD", "PWD", "PASS"]);
  if (!server && !database && !user) return null;
  return {
    server: server || "localhost",
    database: database || "NAPTSKLAD",
    user,
    password,
    source,
  };
}

function parseUdlConnect(text, source) {
  const line = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => /Initial Catalog|Data Source|User ID|Password=/i.test(s) && !s.startsWith(";"));
  if (!line) return null;
  const grab = (key) => {
    const m = line.match(new RegExp(`(?:^|;)\\s*${key}\\s*=\\s*([^;]*)`, "i"));
    return m ? m[1].trim() : "";
  };
  const server = grab("Data Source") || grab("Server") || "localhost";
  const database = grab("Initial Catalog") || grab("Database") || "NAPTSKLAD";
  const user = grab("User ID") || grab("UID");
  const password = grab("Password") || grab("PWD");
  return { server, database, user, password, source };
}

function parseJsonSqlConfig(text, source) {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object") return null;
    return {
      server: String(j.server || j.host || "localhost"),
      database: String(j.database || j.base || "NAPTSKLAD"),
      user: String(j.user || j.uid || ""),
      password: String(j.password || j.pwd || ""),
      source,
    };
  } catch {
    return null;
  }
}

/** Read F-APTEKA / ServiceReports SQL connect settings. */
function readFomSqlConnectFromIni() {
  const out = [];
  const seen = new Set();
  for (const file of collectSqlConfigFiles()) {
    try {
      const raw = fs.readFileSync(file);
      // Strip UTF-16 LE BOM used by some .udl / Notepad files.
      let text;
      if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
        text = raw.toString("utf16le");
      } else if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
        text = raw.slice(3).toString("utf8");
      } else {
        text = raw.toString("utf8");
      }
      const lower = file.toLowerCase();
      let row = null;
      if (lower.endsWith(".udl")) row = parseUdlConnect(text, file);
      else if (lower.endsWith(".json")) row = parseJsonSqlConfig(text, file);
      else row = parseIniConnect(text, file);
      if (!row) continue;
      const key = `${row.server}|${row.database}|${row.user}|${row.password}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      log(`sql cfg: ${path.basename(file)} → ${row.server}/${row.database} user=${row.user || "(windows)"}`);
    } catch {}
  }
  return out;
}

/** Cached working SQL connection string for this agent process. */
let cachedSqlCs = null;

function csVariants(server, database, user, password, trusted) {
  const base = trusted
    ? `Server=${server};Database=${database};Integrated Security=True;Connection Timeout=8;TrustServerCertificate=True`
    : `Server=${server};Database=${database};User ID=${user};Password=${password};Connection Timeout=8;TrustServerCertificate=True`;
  // Encrypt=False fixes many "sa login failed" cases on older SQL Express with new clients.
  return [
    `${base};Encrypt=False`,
    `${base};Encrypt=True`,
    base,
  ];
}

function sqlTargetList() {
  const fromIni = readFomSqlConnectFromIni();
  const targets = [];
  const pushTarget = (t) => {
    targets.push(t);
  };
  for (const row of fromIni) {
    const server = row.server || "localhost";
    const user = row.user || "";
    const password = row.password || "";
    const dbs = [row.database, ...SQL_DB_CANDIDATES].filter(Boolean);
    const uniqDb = [...new Set(dbs.map((d) => String(d)))];
    for (const database of uniqDb) {
      if (user) {
        pushTarget({ server, database, user, password, trusted: false });
        pushTarget({ server, database, user: "", password: "", trusted: true });
      } else {
        pushTarget({ server, database, user: "", password: "", trusted: true });
      }
    }
  }
  // Known IFOR / F-APTEKA defaults (ServiceReports.ini: sa / 1 / NGLOBAL|NAPTSKLAD).
  for (const server of ["localhost", "127.0.0.1", ".", "(local)", "LocalHost", "localhost\\SQLEXPRESS", ".\\SQLEXPRESS"]) {
    for (const database of SQL_DB_CANDIDATES) {
      pushTarget({ server, database, user: "", password: "", trusted: true });
      for (const [user, password] of [
        ["sa", "1"],
        ["sa", "sa"],
        ["sa", "123"],
        ["sa", ""],
        ["sa", "12345"],
        ["sa", "sa123"],
      ]) {
        pushTarget({ server, database, user, password, trusted: false });
      }
    }
  }
  return targets.slice(0, 80);
}

/**
 * Run a SQL query against local F-APTEKA MSSQL; returns array of row objects (column aliases).
 * Writes TSV to a temp file to handle large result sets.
 */
function runSqlQuery(query, timeoutSec = 120) {
  return new Promise((resolve) => {
    ensureDir();
    const outFile = path.join(DATA_DIR, `sql_${Date.now()}_${Math.random().toString(36).slice(2)}.tsv`);
    const errFile = outFile + ".err";
    const buildTargets = () => {
      const list = [];
      const seen = new Set();
      for (const t of sqlTargetList()) {
        for (const cs of csVariants(t.server, t.database, t.user, t.password, t.trusted)) {
          if (seen.has(cs)) continue;
          seen.add(cs);
          list.push({ cs });
        }
      }
      return list.slice(0, 120);
    };
    // Prefer cached CS first, but keep fallbacks if that query fails / returns 0 (wrong DB).
    const targets = cachedSqlCs ? [{ cs: cachedSqlCs }, ...buildTargets()] : buildTargets();
    const payload = Buffer.from(JSON.stringify({ targets, query, outFile, errFile }), "utf8").toString("base64");
    const ps = `
$ErrorActionPreference = 'Stop'
$p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$query = [string]$p.query
$outFile = [string]$p.outFile
$errFile = [string]$p.errFile
$lastErr = ''
$emptyCs = ''
$emptyFile = $outFile + '.empty'
foreach ($t in $p.targets) {
  try {
    $conn = New-Object System.Data.SqlClient.SqlConnection ([string]$t.cs)
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $query
    $cmd.CommandTimeout = ${Math.max(30, Number(timeoutSec) || 120)}
    $r = $cmd.ExecuteReader()
    $tmp = $outFile + '.tmp'
    $sw = New-Object System.IO.StreamWriter($tmp, $false, (New-Object System.Text.UTF8Encoding $false))
    $names = New-Object System.Collections.Generic.List[string]
    for ($i=0; $i -lt $r.FieldCount; $i++) { [void]$names.Add($r.GetName($i)) }
    $tab = [char]9
    $sw.WriteLine(($names -join $tab))
    $n = 0
    while ($r.Read()) {
      $cols = New-Object System.Collections.Generic.List[string]
      for ($i=0; $i -lt $r.FieldCount; $i++) {
        $v = ''
        if (-not $r.IsDBNull($i)) { $v = [string]$r.GetValue($i) }
        $v = $v -replace "[\\t\\r\\n]", ' '
        [void]$cols.Add($v)
      }
      $sw.WriteLine(($cols -join $tab))
      $n++
    }
    $r.Close(); $conn.Close(); $sw.Close()
    if ($n -gt 0) {
      Move-Item -Force $tmp $outFile
      Write-Output ('OKCS|' + $t.cs)
      Write-Output ('OKROWS|' + $n)
      exit 0
    }
    # 0 rows — remember empty hit, keep probing other DBs (wrong DB often has empty tables).
    $emptyCs = [string]$t.cs
    Move-Item -Force $tmp $emptyFile
  } catch {
    $lastErr = $_.Exception.Message
    if (Test-Path ($outFile + '.tmp')) { Remove-Item ($outFile + '.tmp') -Force -ErrorAction SilentlyContinue }
  }
}
if ($emptyCs -and (Test-Path $emptyFile)) {
  Move-Item -Force $emptyFile $outFile
  Write-Output ('OKCS|' + $emptyCs)
  Write-Output ('OKROWS|0')
  exit 0
}
if ($lastErr) { Set-Content -Path $errFile -Value $lastErr -Encoding UTF8 }
Write-Output ('NONE|' + $lastErr)
exit 0
`;
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      windowsHide: true,
    });
    let out = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      try {
        fs.unlinkSync(outFile);
      } catch {}
      resolve([]);
    }, Math.max(45_000, (timeoutSec + 20) * 1000));
    child.stdout.on("data", (d) => {
      out += d.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const csLine = lines.find((s) => s.startsWith("OKCS|"));
      const rowLine = lines.find((s) => s.startsWith("OKROWS|"));
      const noneLine = lines.find((s) => s.startsWith("NONE"));
      if (!csLine || !rowLine) {
        let errMsg = noneLine || "";
        try {
          if (fs.existsSync(errFile)) errMsg = fs.readFileSync(errFile, "utf8").trim();
        } catch {}
        try {
          fs.unlinkSync(outFile);
        } catch {}
        try {
          fs.unlinkSync(errFile);
        } catch {}
        if (errMsg) {
          log(`sql err: ${errMsg.slice(0, 240)}`);
          // Cached CS may be wrong DB — forget it so next call re-probes.
          if (cachedSqlCs) cachedSqlCs = null;
        }
        resolve([]);
        return;
      }
      const rowCount = Number(rowLine.slice(8)) || 0;
      // Only lock onto a CS that actually returned rows (avoids sticky wrong-DB empties).
      if (rowCount > 0) cachedSqlCs = csLine.slice(5);
      else if (cachedSqlCs && csLine.slice(5) === cachedSqlCs) cachedSqlCs = null;
      try {
        fs.unlinkSync(errFile);
      } catch {}
      try {
        const text = fs.readFileSync(outFile, "utf8");
        try {
          fs.unlinkSync(outFile);
        } catch {}
        const all = text.split(/\r?\n/).filter(Boolean);
        if (all.length < 1) {
          resolve([]);
          return;
        }
        const headers = all[0].split("\t");
        const rows = [];
        for (let i = 1; i < all.length; i++) {
          const cols = all[i].split("\t");
          const row = {};
          for (let j = 0; j < headers.length; j++) row[headers[j]] = cols[j] ?? "";
          rows.push(row);
        }
        resolve(rows);
      } catch (e) {
        log(`sql read: ${e instanceof Error ? e.message : String(e)}`);
        resolve([]);
      }
    });
  });
}

function rowsToXml(rows) {
  const parts = rows.map((r) => {
    const attrs = Object.entries(r)
      .filter(([, v]) => v != null && String(v).length > 0)
      .map(([k, v]) => `${k}="${xmlAttr(v)}"`)
      .join(" ");
    return `<V ${attrs} />`;
  });
  return Buffer.from(`<R>${parts.join("")}</R>`, "utf8");
}

function parseJobParams(job) {
  const url = String(job?.localUrl || "");
  let reportId = Number(job?.reportId) || 0;
  let filialId = String(job?.filialId || "1");
  let dateFrom = "01.01.2025";
  let dateTo = "31.12.2026";
  try {
    const u = new URL(url);
    reportId = Number(u.searchParams.get("pReport_id")) || reportId;
    filialId = u.searchParams.get("pFilial_id") || filialId;
    dateFrom = u.searchParams.get("pDateFrom") || dateFrom;
    dateTo = u.searchParams.get("pDateTo") || dateTo;
  } catch {}
  const toIso = (ddmmyyyy) => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ddmmyyyy);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : "2025-01-01";
  };
  return { reportId, filialId, fromIso: toIso(dateFrom), toIso: toIso(dateTo) };
}

function sqlQueryForReport(reportId, filialId, fromIso, toIso) {
  const f = String(filialId).replace(/[^\d]/g, "") || "1";
  const esc = (s) => String(s).replace(/'/g, "''");
  const from = esc(fromIso);
  const to = esc(toIso);
  if (reportId === 189) {
    return `
SET NOCOUNT ON;
SELECT CAST(O.ID AS varchar(20)) AS I,
       REPLACE(REPLACE(ISNULL(O.NAME,N''), CHAR(13), N' '), CHAR(10), N' ') AS N,
       ISNULL(O.INN,'') AS INN,
       CAST(ISNULL(O.INC,0) AS varchar(1)) AS INC,
       CAST(ISNULL(O.INV,0) AS varchar(1)) AS INV,
       CAST(ISNULL(O.APT,0) AS varchar(1)) AS APT,
       CAST(ISNULL(O.INSURE,0) AS varchar(1)) AS INS,
       CAST(ISNULL(O.DISCOUNTS,0) AS varchar(1)) AS DIS
FROM dbo.ORG O WHERE O.NAME IS NOT NULL AND LTRIM(RTRIM(O.NAME)) <> N''`;
  }
  if (reportId === 188) {
    return `
SET NOCOUNT ON;
IF OBJECT_ID('dbo.GOOD','U') IS NOT NULL
  SELECT CAST(G.ID AS varchar(20)) AS I,
         ISNULL(G.NAME,'') AS N,
         ISNULL(G.PRODUCER,'') AS P,
         ISNULL(G.ED,'') AS E,
         ISNULL(G.IKPU, ISNULL(G.MXIK, '')) AS C
  FROM dbo.GOOD G WHERE G.NAME IS NOT NULL;
ELSE IF OBJECT_ID('dbo.GOODS','U') IS NOT NULL
  SELECT CAST(G.ID AS varchar(20)) AS I, ISNULL(G.NAME,'') AS N, ISNULL(G.PRODUCER,'') AS P, '' AS E, '' AS C
  FROM dbo.GOODS G WHERE G.NAME IS NOT NULL;`;
  }
  // allOtdel=true: do not filter OTDEL (used when per-filial query returns empty).
  const otdelFilter = (alias, allOtdel) => (allOtdel ? "1=1" : `${alias} = ${f}`);
  if (reportId === 6) {
    // Two-step friendly stock: batch rest; if schema differs, simpler open-batch sum still works.
    return (allOtdel) => `
SET NOCOUNT ON;
IF OBJECT_ID('dbo.INCOMELN','U') IS NOT NULL AND COL_LENGTH('dbo.INVOICELN','STATE') IS NOT NULL
BEGIN
  SELECT CAST(x.OTDEL AS varchar(20)) AS O, CAST(x.OTDEL AS varchar(20)) AS F,
         CAST(x.GOOD AS varchar(20)) AS G,
         CONVERT(varchar(40), SUM(x.rest)) AS Q,
         CONVERT(varchar(40), MAX(x.PRICEROZ)) AS P,
         CONVERT(varchar(10), MIN(x.EXPDATA), 120) AS E,
         ISNULL(MAX(g.NAME),'') AS N
  FROM (
    SELECT L.OTDEL, L.GOOD, L.PRICEROZ, L.EXPDATA, L.KOL - ISNULL(S.K, 0) AS rest
    FROM dbo.INCOMELN L WITH (NOLOCK)
    LEFT JOIN (
      SELECT INCOMELN, SUM(KOL) AS K FROM dbo.INVOICELN WITH (NOLOCK)
      WHERE STATE IN (11, 12) GROUP BY INCOMELN
    ) S ON S.INCOMELN = L.ID
    WHERE ${otdelFilter("L.OTDEL", allOtdel)}
  ) x
  LEFT JOIN dbo.GOOD g WITH (NOLOCK) ON g.ID = x.GOOD
  WHERE x.rest > 0.0005
  GROUP BY x.OTDEL, x.GOOD;
END
ELSE IF OBJECT_ID('dbo.INCOMELN','U') IS NOT NULL
BEGIN
  SELECT CAST(L.OTDEL AS varchar(20)) AS O, CAST(L.OTDEL AS varchar(20)) AS F,
         CAST(L.GOOD AS varchar(20)) AS G,
         CONVERT(varchar(40), SUM(L.KOL)) AS Q,
         CONVERT(varchar(40), MAX(L.PRICEROZ)) AS P,
         CONVERT(varchar(10), MIN(L.EXPDATA), 120) AS E,
         ISNULL(MAX(g.NAME),'') AS N
  FROM dbo.INCOMELN L WITH (NOLOCK)
  LEFT JOIN dbo.GOOD g WITH (NOLOCK) ON g.ID = L.GOOD
  WHERE ${otdelFilter("L.OTDEL", allOtdel)} AND L.KOL > 0.0005
  GROUP BY L.OTDEL, L.GOOD;
END`;
  }
  if (reportId === 1 || reportId === 11) {
    // Minimal columns — avoid optional fields (PRICEPRIHNDS/SERIA/…) that break older schemas.
    // ONAME = yetkazib beruvchi (dbo.ORG.NAME) so platform never falls back to "Kontragent #id".
    return (allOtdel) => `
SET NOCOUNT ON;
SELECT CAST(H.ID AS varchar(20)) AS ID,
       ISNULL(H.NUMBER,'') AS N,
       CONVERT(varchar(10), H.DATA, 120) AS D,
       CAST(H.OTDEL AS varchar(20)) AS F,
       CAST(H.ORG AS varchar(20)) AS I,
       ISNULL(ORG.NAME,'') AS ONAME,
       CAST(L.GOOD AS varchar(20)) AS G,
       ISNULL(G.NAME,'') AS GN,
       CONVERT(varchar(40), L.KOL) AS Q,
       CONVERT(varchar(40), L.PRICEPRIH) AS P,
       CONVERT(varchar(40), CAST(L.KOL * L.PRICEPRIH AS numeric(20,2))) AS SP,
       '0' AS SN
FROM dbo.INCOME H WITH (NOLOCK)
JOIN dbo.INCOMELN L WITH (NOLOCK) ON L.INCOME = H.ID
LEFT JOIN dbo.GOOD G WITH (NOLOCK) ON G.ID = L.GOOD
LEFT JOIN dbo.ORG ORG WITH (NOLOCK) ON ORG.ID = H.ORG
WHERE H.DOCTYPE = 1
  AND ${otdelFilter("H.OTDEL", allOtdel)}
  AND H.DATA >= '${from}' AND H.DATA < DATEADD(day, 1, '${to}')`;
  }
  if (reportId === 4 || reportId === 14) {
    return (allOtdel) => `
SET NOCOUNT ON;
SELECT CAST(I.ID AS varchar(20)) AS ID,
       ISNULL(I.NUMBER,'') AS N,
       CONVERT(varchar(10), I.DATA, 120) AS D,
       CAST(I.OTDEL AS varchar(20)) AS F,
       CAST(IL.GOOD AS varchar(20)) AS G,
       ISNULL(GD.NAME,'') AS GN,
       CONVERT(varchar(40), L.KOL) AS Q,
       CONVERT(varchar(40), L.PRICE) AS P,
       CONVERT(varchar(40), CAST(L.KOL * L.PRICE AS numeric(20,2))) AS SP,
       '0' AS SN
FROM dbo.INVOICE I WITH (NOLOCK)
JOIN dbo.INVOICELN L WITH (NOLOCK) ON L.INVOICE = I.ID
JOIN dbo.INCOMELN IL WITH (NOLOCK) ON IL.ID = L.INCOMELN
LEFT JOIN dbo.GOOD GD WITH (NOLOCK) ON GD.ID = IL.GOOD
WHERE I.DOCTYPE IN (2, 4)
  AND ${otdelFilter("I.OTDEL", allOtdel)}
  AND I.DATA >= '${from}' AND I.DATA < DATEADD(day, 1, '${to}')`;
  }
  if (reportId === 3) {
    return (allOtdel) => `
SET NOCOUNT ON;
SELECT CAST(I.ID AS varchar(20)) AS ID,
       ISNULL(I.NUMBER,'') AS N,
       CONVERT(varchar(10), I.DATA, 120) AS D,
       CAST(I.OTDEL AS varchar(20)) AS F,
       CAST(IL.GOOD AS varchar(20)) AS G,
       ISNULL(GD.NAME,'') AS GN,
       CONVERT(varchar(40), L.KOL) AS Q,
       CONVERT(varchar(40), IL.PRICEPRIH) AS P,
       CONVERT(varchar(40), CAST(L.KOL * IL.PRICEPRIH AS numeric(20,2))) AS SP,
       '0' AS SN
FROM dbo.INVOICE I WITH (NOLOCK)
JOIN dbo.INVOICELN L WITH (NOLOCK) ON L.INVOICE = I.ID
JOIN dbo.INCOMELN IL WITH (NOLOCK) ON IL.ID = L.INCOMELN
LEFT JOIN dbo.GOOD GD WITH (NOLOCK) ON GD.ID = IL.GOOD
WHERE I.DOCTYPE IN (11, 58)
  AND ${otdelFilter("I.OTDEL", allOtdel)}
  AND I.DATA >= '${from}' AND I.DATA < DATEADD(day, 1, '${to}')`;
  }
  if (reportId === 2 || reportId === 12) {
    return (allOtdel) => `
SET NOCOUNT ON;
SELECT CAST(I.ID AS varchar(20)) AS ID,
       ISNULL(I.NUMBER,'') AS N,
       CONVERT(varchar(10), I.DATA, 120) AS D,
       CAST(I.OTDEL AS varchar(20)) AS F,
       CAST(I.ORG AS varchar(20)) AS I,
       CAST(IL.GOOD AS varchar(20)) AS G,
       ISNULL(GD.NAME,'') AS GN,
       CONVERT(varchar(40), L.KOL) AS Q,
       CONVERT(varchar(40), IL.PRICEPRIH) AS P,
       CONVERT(varchar(40), CAST(L.KOL * IL.PRICEPRIH AS numeric(20,2))) AS SP,
       '0' AS SN
FROM dbo.INVOICE I WITH (NOLOCK)
JOIN dbo.INVOICELN L WITH (NOLOCK) ON L.INVOICE = I.ID
JOIN dbo.INCOMELN IL WITH (NOLOCK) ON IL.ID = L.INCOMELN
LEFT JOIN dbo.GOOD GD WITH (NOLOCK) ON GD.ID = IL.GOOD
WHERE I.DOCTYPE IN (12, 17)
  AND ${otdelFilter("I.OTDEL", allOtdel)}
  AND I.DATA >= '${from}' AND I.DATA < DATEADD(day, 1, '${to}')`;
  }
  return null;
}

async function sqlFallbackForJob(job) {
  const { reportId, filialId, fromIso, toIso } = parseJobParams(job);
  const builder = sqlQueryForReport(reportId, filialId, fromIso, toIso);
  if (!builder) return null;
  const timeoutSec = reportId === 188 || reportId === 6 ? 180 : 300;
  const queryFn = typeof builder === "function" ? builder : () => builder;
  log(`sql fallback report=${reportId} filial=${filialId} ${fromIso}..${toIso}`);
  let rows = await runSqlQuery(queryFn(false), timeoutSec);
  // If this department is empty, pull all OTDELs and keep rows for this filial.
  if (!rows.length && typeof builder === "function") {
    log(`sql fallback retry all-otdel report=${reportId} filial=${filialId}`);
    const all = await runSqlQuery(queryFn(true), timeoutSec);
    const matched = all.filter((r) => {
      const id = String(r.O || r.F || "").trim();
      return !id || id === String(filialId);
    });
    // If OTDEL IDs ≠ report filial ids, still return all so platform can map by F.
    rows = matched.length ? matched : all;
  }
  if (!rows.length) {
    log(`sql fallback empty report=${reportId} filial=${filialId}`);
    return null;
  }
  log(`sql fallback ok report=${reportId} filial=${filialId} rows=${rows.length}`);
  return rowsToXml(rows);
}

function probeOrgNamesFromSql() {
  // Push ALL named orgs (filials + suppliers) so purchases show real yetkazib beruvchi names.
  return runSqlQuery(sqlQueryForReport(189, "1", "2025-01-01", "2026-12-31"), 60).then((rows) =>
    rows
      .filter((r) => r.I && String(r.N || "").trim())
      .map((r) => ({
        I: r.I,
        N: r.N,
        APT: r.APT === "1" || r.APT === "true" ? "1" : "0",
        INC: r.INC === "1" || r.INC === "true" ? "1" : "0",
        INN: r.INN || "",
      })),
  );
}

function orgsToReportXml(rows) {
  return rowsToXml(
    rows.map((r) => ({
      I: r.I,
      N: r.N,
      APT: r.APT || "1",
      INN: r.INN || "",
      INC: "0",
      INV: "0",
      DIS: "0",
      INS: "0",
    })),
  );
}

let lastOrgPushAt = 0;
let cachedOrgRows = null;

async function pushOrgNames(cfg, rows) {
  if (!cfg.token || !rows?.length) return;
  try {
    const res = await requestJson(
      "POST",
      `${cfg.platform}/api/fom/agent/push-org-names`,
      {
        token: cfg.token,
        orgs: rows.map((r) => ({
          I: r.I,
          N: r.N,
          APT: r.APT || "0",
          INC: r.INC || "0",
          INN: r.INN || "",
        })),
      },
      90_000,
    );
    log(`push-org-names: updated=${res.updated?.length ?? 0} named=${res.named ?? 0}`);
  } catch (e) {
    log(`push-org-names: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function refreshOrgNames(cfg, force = false) {
  const now = Date.now();
  if (!force && cachedOrgRows && now - lastOrgPushAt < 5 * 60_000) return cachedOrgRows;
  const rows = await probeOrgNamesFromSql();
  if (rows.length) {
    cachedOrgRows = rows;
    lastOrgPushAt = now;
    await pushOrgNames(cfg, rows);
  }
  return rows;
}

function jobIsOrgReport(job) {
  const url = String(job?.localUrl || "");
  return /pReport_id=189\b/i.test(url) || Number(job?.reportId) === 189;
}

async function sendHello(cfg) {
  const { port, listening } = await refreshLocalFom(cfg);
  writeConfig(cfg);
  const host = (await publicIp()) || localIps()[0] || "";
  const data = await requestJson("POST", `${cfg.platform}/api/fom/agent/hello`, {
    token: cfg.token,
    host,
    port,
    machine: os.hostname(),
    localIps: localIps(),
    reportListening: listening,
    protocol: "http",
    agentVersion: 7,
  }, 45_000);
  latestLive.online = true;
  latestLive.platformOnline = true;
  latestLive.reportPort = port;
  latestLive.reportListening = listening;
  latestLive.message = data.message || "Ulandi";
  void refreshOrgNames(cfg, false).catch((e) => log(`org names: ${e instanceof Error ? e.message : String(e)}`));
  return data;
}

async function pollJobs(cfg) {
  const data = await requestJson("POST", `${cfg.platform}/api/fom/agent/poll`, { token: cfg.token }, 30_000);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  for (const job of jobs) {
    try {
      log(`fetch ${job.localUrl}`);
      let buf = await getBuffer(job.localUrl, 900_000);
      let xml = buf.toString("utf8");
      if (/<HTML|<BODY>\s*<B>\s*200/i.test(xml)) {
        const sqlBuf = await sqlFallbackForJob(job);
        if (sqlBuf && sqlBuf.length > 10) {
          buf = sqlBuf;
          xml = buf.toString("utf8");
          log(`job ${job.id}: REPORT HTML → SQL fallback bytes=${buf.length}`);
          if (jobIsOrgReport(job)) {
            void refreshOrgNames(cfg, true).catch(() => {});
          }
        } else {
          throw new Error("REPORT HTML 200 OK (SQL fallback ham bo'sh)");
        }
      }
      const xmlBase64 = buf.toString("base64");
      await requestJson(
        "POST",
        `${cfg.platform}/api/fom/agent/job-result`,
        { token: cfg.token, jobId: job.id, ok: true, xmlBase64 },
        900_000,
      );
      log(`job ok ${job.id} bytes=${buf.length}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`job fail ${job.id} ${message}`);
      try {
        await requestJson(
          "POST",
          `${cfg.platform}/api/fom/agent/job-result`,
          { token: cfg.token, jobId: job.id, ok: false, message },
          30_000,
        );
      } catch {}
    }
  }
  return jobs.length;
}

async function refreshLive(cfg) {
  await refreshLocalFom(cfg);
  if (!cfg.token) {
    latestLive.online = false;
    latestLive.platformOnline = false;
    return;
  }
  try {
    const live = await requestJson(
      "POST",
      `${cfg.platform}/api/fom/agent/live`,
      { token: cfg.token },
      20_000,
    );
    latestLive = {
      ...latestLive,
      ...live,
      online: true,
      platformOnline: true,
      reportPort: cfg.reportPort,
      reportListening: latestLive.reportListening,
      companyName: live.companyName || latestLive.companyName,
    };
  } catch (e) {
    latestLive.online = false;
    latestLive.platformOnline = false;
    latestLive.message = e instanceof Error ? e.message : String(e);
  }
}

async function startFullSync(cfg) {
  try {
    const res = await requestJson("POST", `${cfg.platform}/api/fom/agent/start-sync`, { token: cfg.token }, 60_000);
    log(`sync: ${res.message || "started"}`);
  } catch (e) {
    log(`sync start: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function workerLoop() {
  if (loopStarted) return;
  loopStarted = true;
  while (!stopFlag) {
    const cfg = readConfig();
    if (!cfg.token) {
      await sleep(2000);
      continue;
    }
    try {
      await sendHello(cfg);
      const n = await pollJobs(cfg);
      await refreshLive(cfg);
      await sleep(n > 0 ? 200 : 1000);
    } catch (e) {
      latestLive.online = false;
      latestLive.message = e instanceof Error ? e.message : String(e);
      log("loop: " + latestLive.message);
      await sleep(3000);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res, code, data, type = "application/json; charset=utf-8") {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${UI_PORT}`);
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return send(res, 200, uiHtml(), "text/html; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/api/local/config") {
        const cfg = readConfig();
        return send(res, 200, { platform: cfg.platform, token: cfg.token, reportPort: cfg.reportPort, autostart: cfg.autostart });
      }
      if (req.method === "POST" && url.pathname === "/api/local/config") {
        const body = await readBody(req);
        const platform = String(body.platform || DEFAULT_PLATFORM).trim().replace(/\/+$/, "");
        const token = String(body.token || "").trim();
        if (!token || token.length < 10) return send(res, 400, { error: "Token notoʻgʻri yoki juda qisqa." });
        const cfg = { ...readConfig(), platform, token };
        await refreshLocalFom(cfg);
        writeConfig(cfg);
        await sendHello(cfg);
        await enableAutostart();
        void workerLoop();
        // connectOnly: do NOT start full sync yet — user presses the sync button.
        return send(res, 200, {
          ok: true,
          message: "Platformaga ulandi. Admin panelda «Kompyuter onlayn» chiqishi kerak. Keyin sinxronlashni boshlang.",
        });
      }
      if (req.method === "POST" && url.pathname === "/api/local/sync") {
        const cfg = readConfig();
        if (!cfg.token) return send(res, 400, { error: "Avval token bilan platformaga ulaning." });
        const { listening } = await refreshLocalFom(cfg);
        if (!listening) {
          return send(res, 400, { error: "REPORT.exe topilmadi. FOM bazasiga ulanish uchun REPORT.exe ni yoqing." });
        }
        await sendHello(cfg);
        await startFullSync(cfg);
        void workerLoop();
        return send(res, 200, {
          ok: true,
          message: "Sinxronlash boshlandi: 01.01.2025 dan bugungacha. Foiz shu oynada yangilanadi.",
        });
      }
      if (req.method === "GET" && url.pathname === "/api/local/live") {
        const cfg = readConfig();
        await refreshLive(cfg).catch(() => {});
        return send(res, 200, latestLive);
      }
      if (req.method === "POST" && url.pathname === "/api/local/autostart") {
        return send(res, 200, await enableAutostart());
      }
      if (req.method === "POST" && url.pathname === "/api/local/quit") {
        stopFlag = true;
        await disableAutostart();
        send(res, 200, { ok: true });
        setTimeout(() => process.exit(0), 300);
        return;
      }
      send(res, 404, { error: "Not found" });
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  server.listen(UI_PORT, "127.0.0.1", () => {
    log(`UI http://127.0.0.1:${UI_PORT}`);
    openUi();
    const cfg = readConfig();
    if (cfg.token) void workerLoop();
  });
}

ensureDir();
log(`PHARMXS FOM Agent v7 start pid=${process.pid}`);
(async () => {
  try {
    const rows = await runSqlQuery("SELECT DB_NAME() AS DB, SUSER_SNAME() AS U", 20);
    if (rows.length) log(`sql probe ok db=${rows[0].DB || "?"} user=${rows[0].U || "?"}`);
    else log("sql probe: ulanmadi — ServiceReports.ini (sa/1) yoki NAPTSKLAD tekshiring");
  } catch (e) {
    log(`sql probe: ${e instanceof Error ? e.message : String(e)}`);
  }
})();
startServer();
