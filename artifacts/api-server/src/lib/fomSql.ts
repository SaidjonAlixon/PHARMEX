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
export function fomSqlOrganizations(cfg: FomSqlConfig, timeoutMs: number) {
  return queryRows(cfg, timeoutMs, `
    SELECT O.ID AS I, O.NAME AS N, O.INN AS INN,
           CAST(ISNULL(O.INC, 0) AS int) AS INC, CAST(ISNULL(O.INV, 0) AS int) AS INV,
           CAST(ISNULL(O.APT, 0) AS int) AS APT, CAST(ISNULL(O.INSURE, 0) AS int) AS INS,
           CAST(ISNULL(O.DISCOUNTS, 0) AS int) AS DIS
    FROM dbo.ORG O WHERE O.NAME IS NOT NULL`);
}

/**
 * Current stock per department and good, for procedure versions without report 6.
 * A batch (INCOMELN; pharmacies post with STATE 12, the warehouse keeps supplier receipts at
 * STATE 3) minus its posted outgoing lines (INVOICELN STATE 11/12: sales, transfers, write-offs,
 * returns). INCOMELN.SALE is not kept in step, so it is not used.
 * Columns: F department, G good, Q quantity, C cost value, P retail price, E nearest expiry.
 */
export function fomSqlStock(cfg: FomSqlConfig, timeoutMs: number) {
  return queryRows(cfg, timeoutMs, `
    SELECT x.OTDEL AS F, x.GOOD AS G,
           CONVERT(varchar(40), SUM(x.rest)) AS Q,
           CONVERT(varchar(40), CAST(SUM(x.rest * x.PRICEPRIH) AS numeric(20, 2))) AS C,
           CONVERT(varchar(40), MAX(x.PRICEROZ)) AS P,
           CONVERT(varchar(10), MIN(x.EXPDATA), 120) AS E
    FROM (
      SELECT L.OTDEL, L.GOOD, L.PRICEPRIH, L.PRICEROZ, L.EXPDATA, L.KOL - ISNULL(S.K, 0) AS rest
      FROM dbo.INCOMELN L
      LEFT JOIN (SELECT INCOMELN, SUM(KOL) AS K FROM dbo.INVOICELN WHERE STATE IN (11, 12) GROUP BY INCOMELN) S
        ON S.INCOMELN = L.ID
      WHERE L.STATE IN (3, 12)
    ) x
    WHERE x.rest > 0.0005
    GROUP BY x.OTDEL, x.GOOD`);
}

/**
 * Internal moves, one row per line: 15 warehouse → pharmacy, 13 pharmacy → warehouse,
 * 57 pharmacy → pharmacy. The receiving side (INCOME 19, INVOICE 16) mirrors these and is skipped.
 * Columns: ID, DT doc type, N number, D date, F from department, T to department (ORG id),
 * R purpose, G good, Q quantity, C unit cost, P unit price.
 */
export function fomSqlTransfers(cfg: FomSqlConfig, scope: FomScope, timeoutMs: number) {
  return queryRows(cfg, timeoutMs, `
    SELECT I.ID, I.DOCTYPE AS DT, I.NUMBER AS N, CONVERT(varchar(10), I.DATA, 120) AS D,
           I.OTDEL AS F, I.ORG AS T, ISNULL(I.PURPOSE, '') AS R,
           IL.GOOD AS G, CONVERT(varchar(40), L.KOL) AS Q,
           CONVERT(varchar(40), IL.PRICEPRIH) AS C, CONVERT(varchar(40), L.PRICE) AS P,
           CONVERT(varchar(40), CAST(L.KOL * IL.PRICEPRIH AS numeric(20, 2))) AS A
    FROM dbo.INVOICE I
    JOIN dbo.INVOICELN L ON L.INVOICE = I.ID
    JOIN dbo.INCOMELN IL ON IL.ID = L.INCOMELN
    WHERE I.DOCTYPE IN (13, 15, 57) AND L.STATE IN (11, 12)
      AND ${inScope("I", scope, "inv")}
    ORDER BY I.ID, L.ID`, bindScope(scope));
}

/**
 * Money per day, department and payment type. PAYIN: 20 Humo, 21 cash, 22 online, 23 other,
 * 24 bonus (retail receipts); PAYOUT: 40 encashment, 52 supplier payment, 56 other spending.
 * Columns: DIR in/out, DT doc type, F department, D day, C row count, S sum.
 */
export function fomSqlPayments(cfg: FomSqlConfig, scope: FomScope, timeoutMs: number) {
  const part = (table: string, dir: string, types: string) => `
    SELECT '${dir}' AS DIR, P.DOCTYPE AS DT, P.CASHBOX AS CB, ISNULL(B.NAME, '') AS CN, P.OTDEL AS F,
           CONVERT(varchar(10), P.DATA, 120) AS D, COUNT(*) AS C, CONVERT(varchar(40), SUM(P.SUMMA)) AS S
    FROM dbo.${table} P LEFT JOIN dbo.CASHBOX B ON B.ID = P.CASHBOX
    WHERE P.DOCTYPE IN (${types}) AND ${
      // Day totals: in change mode recompute every day with a new or edited row, and the recent
      // days, whose rows may still be arriving from the pharmacies.
      scope.since
        ? `(P.DATA >= @recent OR P.DATA IN (SELECT DISTINCT X.DATA FROM dbo.${table} X WHERE ${inScope("X", scope)}))`
        : inScope("P", scope)
    }
    GROUP BY P.DOCTYPE, P.CASHBOX, B.NAME, P.OTDEL, CONVERT(varchar(10), P.DATA, 120)`;
  return queryRows(cfg, timeoutMs, `${part("PAYIN", "in", "2, 20, 21, 22, 23, 24")} UNION ALL ${part("PAYOUT", "out", "40, 52, 56")}`, bindScope(scope));
}

/**
 * Supplier receipts into the warehouse (INCOME 1), one row per line. PRICEPRIH is the unit cost
 * with VAT, PRICEPRIHNDS its VAT; the line sums equal INCOME.SUMMAPOZ.
 * Columns: ID, N, D, F department, O supplier ORG, PN / PD supplier invoice, DUE payment date,
 * R purpose, G, Q, C unit cost, V unit VAT, A / VA line cost / VAT, S series, E expiry.
 */
export function fomSqlPurchases(cfg: FomSqlConfig, scope: FomScope, timeoutMs: number) {
  return queryRows(cfg, timeoutMs, `
    SELECT H.ID, H.NUMBER AS N, CONVERT(varchar(10), H.DATA, 120) AS D, H.OTDEL AS F, H.ORG AS O,
           ISNULL(H.SNUMBER, '') AS PN, CONVERT(varchar(10), H.SDATA, 120) AS PD, CONVERT(varchar(10), H.DATAOTS, 120) AS DUE,
           ISNULL(H.PURPOSE, '') AS R, L.GOOD AS G, CONVERT(varchar(40), L.KOL) AS Q,
           CONVERT(varchar(40), L.PRICEPRIH) AS C, CONVERT(varchar(40), L.PRICEPRIHNDS) AS V,
           CONVERT(varchar(40), CAST(L.KOL * L.PRICEPRIH AS numeric(20, 2))) AS A,
           CONVERT(varchar(40), CAST(L.KOL * L.PRICEPRIHNDS AS numeric(20, 2))) AS VA,
           ISNULL(L.SERIA, '') AS S, CONVERT(varchar(10), L.EXPDATA, 120) AS E
    FROM dbo.INCOME H JOIN dbo.INCOMELN L ON L.INCOME = H.ID
    WHERE H.DOCTYPE = 1 AND H.STATE IN (3, 12) AND ${inScope("H", scope, "inc")}
    ORDER BY H.ID, L.ID`, bindScope(scope));
}

/**
 * Which documents a query reads: a day range (`from`..`to`, document date), or — when `since` is
 * set — every document entered or edited at / after `since` (F-APTEKA clock) dated from `floor`.
 * F-APTEKA times are local wall-clock; Dates here carry them as UTC fields (mssql useUTC).
 */
export interface FomScope {
  from: Date;
  to: Date;
  since?: Date;
  floor?: Date;
  /**
   * Change mode: documents to read whatever their timestamps. Pharmacies' rows reach this
   * database late but keep their till time, so a time window alone misses them.
   */
  missing?: { inv: string[]; inc: string[] };
  /** Change mode: money day totals from this day on are always recomputed (late rows). */
  recent?: Date;
}

/** `table`: whose missing ids apply — INVOICE ("inv") or INCOME ("inc"). */
function inScope(alias: string, scope: FomScope, table?: "inv" | "inc") {
  if (!scope.since) return `${alias}.DATA >= @from AND ${alias}.DATA < DATEADD(day, 1, @to)`;
  const changed = `(${alias}.DATA >= @floor AND ISNULL(${alias}.DATACHANGE, ${alias}.DATAENTER) >= @since)`;
  const ids = table ? (scope.missing?.[table] ?? []).filter((id) => /^\d+$/.test(id)) : [];
  return ids.length ? `(${changed} OR ${alias}.ID IN (${ids.join(", ")}))` : changed;
}

const bindScope = (scope: FomScope) => (request: sql.Request) => {
  request.input("from", sql.DateTime, scope.from);
  request.input("to", sql.DateTime, scope.to);
  request.input("since", sql.DateTime, scope.since ?? scope.from);
  request.input("floor", sql.DateTime, scope.floor ?? scope.from);
  request.input("recent", sql.DateTime, scope.recent ?? scope.since ?? scope.from);
};

/**
 * Posted documents dated from `floor`, ids only: compared with what PHARMEX holds to find rows
 * that reached F-APTEKA's database after the change window had passed them.
 * Columns: T inv / inc, ID.
 */
export function fomSqlRecentDocIds(cfg: FomSqlConfig, floor: Date, timeoutMs: number) {
  return queryRows(cfg, timeoutMs, `
    SELECT 'inv' AS T, I.ID FROM dbo.INVOICE I
    WHERE I.DATA >= @floor AND I.STATE IN (11, 12) AND I.DOCTYPE IN (2, 4, 6, 9, 11, 12, 13, 15, 17, 57, 58)
    UNION ALL
    SELECT 'inc', H.ID FROM dbo.INCOME H
    WHERE H.DATA >= @floor AND ((H.DOCTYPE = 1 AND H.STATE IN (3, 12)) OR (H.DOCTYPE = 9 AND H.STATE = 12))`,
    (request) => request.input("floor", sql.DateTime, floor));
}

/** F-APTEKA server clock (local wall-clock time), `yyyy-mm-ddThh:mm:ss`. */
export async function fomSqlNow(cfg: FomSqlConfig, timeoutMs: number): Promise<string> {
  const [row] = await queryRows(cfg, timeoutMs, "SELECT CONVERT(varchar(19), GETDATE(), 126) AS T");
  return row?.T ?? "";
}

/**
 * Retail receipts (INVOICE 2) and retail returns (4, negative KOL), one row per line with the
 * batch cost. PRICE is after discount, PRICE1 before it; NDS is per unit.
 * Columns: ID, DT, N, T entered at (local time), D day, F department, G good, Q, P, P1, V, C,
 * A line amount, DA line discount and CA line cost (KOL × price rounded to tiyin, KOL keeps 6 decimals).
 */
export function fomSqlReceiptLines(cfg: FomSqlConfig, scope: FomScope, timeoutMs: number) {
  return queryRows(cfg, timeoutMs, `
    SELECT I.ID, I.DOCTYPE AS DT, I.NUMBER AS N, CONVERT(varchar(19), I.DATAENTER, 126) AS T,
           CONVERT(varchar(10), I.DATA, 120) AS D, I.OTDEL AS F, IL.GOOD AS G,
           CONVERT(varchar(40), L.KOL) AS Q, CONVERT(varchar(40), L.PRICE) AS P, CONVERT(varchar(40), L.PRICE1) AS P1,
           CONVERT(varchar(40), L.NDS) AS V, CONVERT(varchar(40), IL.PRICEPRIH) AS C,
           CONVERT(varchar(40), CAST(L.KOL * L.PRICE AS numeric(20, 2))) AS A,
           CONVERT(varchar(40), CAST(L.KOL * CASE WHEN L.PRICE1 > L.PRICE THEN L.PRICE1 - L.PRICE ELSE 0 END AS numeric(20, 2))) AS DA,
           CONVERT(varchar(40), CAST(L.KOL * IL.PRICEPRIH AS numeric(20, 2))) AS CA
    FROM dbo.INVOICE I
    JOIN dbo.INVOICELN L ON L.INVOICE = I.ID
    JOIN dbo.INCOMELN IL ON IL.ID = L.INCOMELN
    WHERE I.DOCTYPE IN (2, 4) AND L.STATE IN (11, 12)
      AND ${inScope("I", scope, "inv")}
    ORDER BY I.ID, L.ID`, bindScope(scope));
}

/** Payments of the receipts above, per receipt and cash box. Columns: ID receipt, DT, CB, CN, S sum. */
export function fomSqlReceiptPayments(cfg: FomSqlConfig, scope: FomScope, timeoutMs: number) {
  return queryRows(cfg, timeoutMs, `
    SELECT P.INVOICE AS ID, MAX(P.DOCTYPE) AS DT, P.CASHBOX AS CB, ISNULL(B.NAME, '') AS CN,
           CONVERT(varchar(40), SUM(P.SUMMA)) AS S
    FROM dbo.PAYIN P JOIN dbo.INVOICE I ON I.ID = P.INVOICE LEFT JOIN dbo.CASHBOX B ON B.ID = P.CASHBOX
    WHERE I.DOCTYPE IN (2, 4) AND ${inScope("I", scope, "inv")}
    GROUP BY P.INVOICE, P.CASHBOX, B.NAME`, bindScope(scope));
}

/**
 * Other stock documents, one row per line. INVOICE 11 write-off, 58 expired write-off,
 * 12 supplier return, 17 expired return, 6 / 9 inventory shortage; INCOME 9 inventory surplus.
 * Columns: K key, DT, N, D, F department, O counterparty ORG, R purpose, G, Q, C unit cost.
 */
export function fomSqlStockDocuments(cfg: FomSqlConfig, scope: FomScope, timeoutMs: number) {
  return queryRows(cfg, timeoutMs, `
    SELECT 'inv:' + CONVERT(varchar(20), I.ID) AS K, I.DOCTYPE AS DT, I.NUMBER AS N, CONVERT(varchar(10), I.DATA, 120) AS D,
           I.OTDEL AS F, I.ORG AS O, ISNULL(I.PURPOSE, '') AS R, IL.GOOD AS G,
           CONVERT(varchar(40), L.KOL) AS Q, CONVERT(varchar(40), IL.PRICEPRIH) AS C,
           CONVERT(varchar(40), CAST(L.KOL * IL.PRICEPRIH AS numeric(20, 2))) AS A
    FROM dbo.INVOICE I
    JOIN dbo.INVOICELN L ON L.INVOICE = I.ID
    JOIN dbo.INCOMELN IL ON IL.ID = L.INCOMELN
    WHERE I.DOCTYPE IN (6, 9, 11, 12, 17, 58) AND L.STATE IN (11, 12)
      AND ${inScope("I", scope, "inv")}
    UNION ALL
    SELECT 'inc:' + CONVERT(varchar(20), H.ID), 1009, H.NUMBER, CONVERT(varchar(10), H.DATA, 120),
           H.OTDEL, H.ORG, ISNULL(H.PURPOSE, ''), L.GOOD,
           CONVERT(varchar(40), L.KOL), CONVERT(varchar(40), L.PRICEPRIH),
           CONVERT(varchar(40), CAST(L.KOL * L.PRICEPRIH AS numeric(20, 2)))
    FROM dbo.INCOME H JOIN dbo.INCOMELN L ON L.INCOME = H.ID
    WHERE H.DOCTYPE = 9 AND H.STATE = 12 AND ${inScope("H", scope, "inc")}
    ORDER BY 1`, bindScope(scope));
}

async function queryRows(
  cfg: FomSqlConfig,
  timeoutMs: number,
  text: string,
  bind?: (request: sql.Request) => void,
): Promise<Array<Record<string, string>>> {
  const p = await pool(cfg, timeoutMs);
  const request = p.request();
  bind?.(request);
  const result = await request.query<Record<string, unknown>>(text);
  return result.recordset.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? "" : String(v).trim()])),
  );
}

function fomDay(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}
