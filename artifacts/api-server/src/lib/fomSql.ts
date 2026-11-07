import sql from "mssql";

/**
 * Direct SQL access to F-APTEKA's own dbo.P_GetReport_XML — the procedure ServiceReports wraps.
 * Enabled by FOM_SQL_HOST; the server must reach the pharmacy SQL Server (router port forward).
 */
export interface FomSqlConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
}

export function fomSqlConfig(): FomSqlConfig | null {
  const server = process.env.FOM_SQL_HOST?.trim();
  if (!server) return null;
  return {
    server,
    port: Number(process.env.FOM_SQL_PORT) || 1433,
    database: process.env.FOM_SQL_DATABASE?.trim() || "NGLOBAL",
    user: process.env.FOM_SQL_USER?.trim() || "",
    password: process.env.FOM_SQL_PASSWORD ?? "",
    // The link crosses the internet; only very old SQL Servers without TLS 1.2 need FOM_SQL_ENCRYPT=false.
    encrypt: process.env.FOM_SQL_ENCRYPT?.trim().toLowerCase() !== "false",
  };
}

export function fomSqlUrl(cfg: FomSqlConfig): string {
  return `mssql://${cfg.server}:${cfg.port}/${cfg.database}`;
}

export class FomSqlConnectionError extends Error {}

let poolPromise: Promise<sql.ConnectionPool> | null = null;

function pool(cfg: FomSqlConfig, timeoutMs: number): Promise<sql.ConnectionPool> {
  poolPromise ??= new sql.ConnectionPool({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeout: 15_000,
    requestTimeout: timeoutMs,
    pool: { max: 2, min: 0, idleTimeoutMillis: 60_000 },
    // F-APTEKA servers only have SQL Server's self-signed certificate.
    options: { encrypt: cfg.encrypt, trustServerCertificate: true },
  })
    .connect()
    .catch((error: unknown) => {
      poolPromise = null;
      throw new FomSqlConnectionError(error instanceof Error ? error.message : String(error));
    });
  return poolPromise;
}

interface ProcInfo {
  params: Array<{ name: string; type: string }>;
  reports: Set<number>;
}
let procInfo: { at: number; value: ProcInfo } | null = null;

/** Parameter list and the @pReport_id values the installed procedure version handles (cached 10 min). */
export async function fomSqlProcInfo(cfg: FomSqlConfig, timeoutMs: number): Promise<ProcInfo> {
  if (procInfo && Date.now() - procInfo.at < 10 * 60_000) return procInfo.value;
  const p = await pool(cfg, timeoutMs);
  const params = await p.request().query<{ name: string; type: string }>(
    `SELECT p.name, t.name AS type FROM sys.parameters p JOIN sys.types t ON t.user_type_id = p.user_type_id
     WHERE p.object_id = OBJECT_ID('dbo.P_GetReport_XML') ORDER BY p.parameter_id`,
  );
  if (params.recordset.length === 0) {
    throw new Error(`dbo.P_GetReport_XML ${cfg.database} bazasida topilmadi.`);
  }
  const def = await p.request().query<{ text: string | null }>(
    "SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.P_GetReport_XML')) AS text",
  );
  const reports = new Set<number>();
  for (const m of (def.recordset[0]?.text ?? "").matchAll(/@pReport_id\s*=\s*(\d+)/gi)) reports.add(Number(m[1]));
  const value = { params: params.recordset.map((r) => ({ name: r.name, type: r.type.toLowerCase() })), reports };
  procInfo = { at: Date.now(), value };
  return value;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Runs one report; returns the procedure's XML (FOR XML output, or a plain recordset rendered as <V/> rows). */
export async function execFomSqlReport(
  cfg: FomSqlConfig,
  reportId: number,
  filialId: string,
  from: Date,
  to: Date,
  timeoutMs: number,
): Promise<string> {
  const info = await fomSqlProcInfo(cfg, timeoutMs);
  const p = await pool(cfg, timeoutMs);
  const request = p.request();
  for (const { name, type } of info.params) {
    const key = name.replace(/^@/, "");
    const lower = key.toLowerCase();
    const isDate = type.includes("date") || type.includes("time");
    const isInt = type.includes("int");
    if (/from|begin|start/.test(lower)) request.input(key, isDate ? sql.DateTime : sql.NVarChar, isDate ? from : fomDay(from));
    else if (/end|to$/.test(lower)) request.input(key, isDate ? sql.DateTime : sql.NVarChar, isDate ? to : fomDay(to));
    else if (lower.includes("filial")) request.input(key, isInt ? sql.Int : sql.NVarChar, isInt ? Number(filialId) : filialId);
    else if (lower.includes("report")) request.input(key, isInt ? sql.Int : sql.NVarChar, isInt ? reportId : String(reportId));
    else request.input(key, null);
  }
  const result = await request.execute("dbo.P_GetReport_XML");
  const sets = (result.recordsets as unknown as Array<Array<Record<string, unknown>> & { columns: Record<string, unknown> }>) ?? [];
  let xml = "";
  let rows = "";
  for (const set of sets) {
    const columns = Object.keys(set.columns ?? set[0] ?? {});
    if (columns.length === 1 && columns[0]!.toLowerCase() === "errormessage") {
      throw new Error(`P_GetReport_XML xatosi: ${String(set[0]?.[columns[0]!] ?? "nomaʼlum")}`);
    }
    if (columns.length === 1) {
      for (const row of set) xml += row[columns[0]!] == null ? "" : String(row[columns[0]!]);
      continue;
    }
    for (const row of set) {
      rows += "<V";
      for (const col of columns) {
        const v = row[col];
        if (v == null) continue;
        rows += ` ${col}="${esc(v instanceof Date ? v.toISOString().slice(0, 19) : String(v))}"`;
      }
      rows += " />";
    }
  }
  return `<R>${xml}${rows}</R>`;
}

/**
 * Report 189's fields from F-APTEKA's ORG table, for procedure versions without that report.
 * ORG ids of APT rows equal the OTDEL ids the document reports filter on.
 */
export async function fomSqlOrganizations(cfg: FomSqlConfig, timeoutMs: number): Promise<Array<Record<string, string>>> {
  const p = await pool(cfg, timeoutMs);
  const result = await p.request().query<Record<string, unknown>>(`
    SELECT O.ID AS I, O.NAME AS N, O.INN AS INN,
           CAST(ISNULL(O.INC, 0) AS int) AS INC, CAST(ISNULL(O.INV, 0) AS int) AS INV,
           CAST(ISNULL(O.APT, 0) AS int) AS APT, CAST(ISNULL(O.INSURE, 0) AS int) AS INS,
           CAST(ISNULL(O.DISCOUNTS, 0) AS int) AS DIS
    FROM dbo.ORG O WHERE O.NAME IS NOT NULL`);
  return result.recordset.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? "" : String(v).trim()])),
  );
}

function fomDay(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}
