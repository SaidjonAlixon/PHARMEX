import {
  FomSqlConnectionError,
  execFomSqlReport,
  fomSqlConfig,
  fomSqlNow,
  fomSqlOrganizations,
  fomSqlPayments,
  fomSqlProcInfo,
  fomSqlPurchases,
  fomSqlReceiptLines,
  fomSqlReceiptPayments,
  fomSqlRecentDocIds,
  fomSqlStock,
  fomSqlStockDocuments,
  fomSqlTransfers,
  fomSqlUrl,
  type FomScope,
  type FomSqlConfig,
} from "./fomSql";

export type FomRow = Record<string, string>;

export interface FomReportDef {
  id: number;
  key: string;
  label: string;
  target: string;
  dated: boolean;
}

/** REPORT.exe (P_GetReport_XML) reports that PHARMXS imports. */
export const FOM_REPORTS = {
  organizations: { id: 189, key: "organizations", label: "Tashkilotlar maʼlumotnomasi", target: "Filiallar, yetkazib beruvchilar, mijozlar", dated: false },
  catalog: { id: 188, key: "catalog", label: "Tovarlar maʼlumotnomasi", target: "Tovarlar (nomi, ishlab chiqaruvchi, IKPU, birlik)", dated: false },
  stock: { id: 6, key: "stock", label: "Joriy qoldiqlar", target: "Ombor qoldiqlari, chakana narx, yaroqlilik muddati", dated: false },
  purchases: { id: 11, key: "purchases", label: "Omborga kirim (v2)", target: "Kirim hujjatlari va tannarx", dated: true },
  supplierReturns: { id: 12, key: "supplierReturns", label: "Yetkazib beruvchiga qaytarish (v2)", target: "Tovar harakati: qaytarish", dated: true },
  writeOffs: { id: 3, key: "writeOffs", label: "Hisobdan chiqarish", target: "Tovar harakati: hisobdan chiqarish", dated: true },
  retailSales: { id: 14, key: "retailSales", label: "Chakana savdo (v2)", target: "Savdolar (cheklar)", dated: true },
  insuranceSales: { id: 15, key: "insuranceSales", label: "Sugʻurta savdosi (v2)", target: "Savdolar (sugʻurta orqali)", dated: true },
  // Not P_GetReport_XML reports: read from F-APTEKA's tables in SQL mode only (id 0).
  incomes: { id: 0, key: "incomes", label: "Omborga kirim (hujjat boʻyicha)", target: "Kirim: yetkazib beruvchi, faktura, tannarx, QQS", dated: true },
  receipts: { id: 0, key: "receipts", label: "Cheklar (tannarx bilan)", target: "Savdolar: har bir chek, toʻlov turi, chegirma, tannarx", dated: true },
  stockDocuments: { id: 0, key: "stockDocuments", label: "Hisobdan chiqarish, qaytarish, inventarizatsiya", target: "Tovar harakati va xarajatlar", dated: true },
  transfers: { id: 0, key: "transfers", label: "Ichki koʻchirishlar", target: "Tovar harakati: ombor ↔ dorixona oʻtkazmalari", dated: true },
  payments: { id: 0, key: "payments", label: "Kassa tushumlari", target: "Pul operatsiyalari: naqd, Humo, onlayn, boshqa", dated: true },
} satisfies Record<string, FomReportDef>;

export type FomReportKey = keyof typeof FOM_REPORTS;

export interface FomConfig {
  reportUrl: string | null;
  filialIds: string[];
  siteToken: string | null;
  /** Optional access key sent as a header to REPORT.exe (if the FOM server requires one). */
  apiToken: string | null;
  timeoutMs: number;
  initialDays: number;
  intervalMinutes: number;
  refsIntervalMinutes: number;
}

/** Values saved from the settings page; they take precedence over env. */
export type FomSavedConfig = Partial<Omit<FomConfig, "siteToken">>;

let saved: FomSavedConfig | null = null;

export function setSavedFomConfig(value: FomSavedConfig | null) {
  saved = value;
}

export function fomSavedConfig(): FomSavedConfig | null {
  return saved;
}

export function parseFilialIds(raw: string): string[] {
  return [...new Set(raw.split(/[,;\s]+/).map((id) => id.trim()).filter(Boolean))];
}

export function fomEnvConfig(): FomConfig {
  const positive = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const sqlCfg = fomSqlConfig();
  return {
    reportUrl: sqlCfg ? fomSqlUrl(sqlCfg) : process.env.FOM_REPORT_URL?.trim().replace(/\/+$/, "") || null,
    filialIds: parseFilialIds(process.env.FOM_FILIAL_IDS ?? ""),
    siteToken: process.env.FOM_SITE_TOKEN?.trim() || null,
    apiToken: process.env.FOM_API_TOKEN?.trim() || null,
    timeoutMs: positive(process.env.FOM_TIMEOUT_MS, 120_000),
    initialDays: positive(process.env.FOM_INITIAL_DAYS, 90),
    intervalMinutes: Number(process.env.FOM_SYNC_INTERVAL_MIN) || 0,
    refsIntervalMinutes: positive(process.env.FOM_REFS_INTERVAL_MIN, 60),
  };
}

export function fomConfig(): FomConfig {
  const env = fomEnvConfig();
  if (!saved) return env;
  const merged = { ...env };
  for (const [key, value] of Object.entries(saved) as Array<[keyof FomSavedConfig, unknown]>) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** F-APTEKA expects dd.mm.yyyy. */
export function fomDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}

export function reportUrl(
  base: string,
  reportId: number,
  filialId: string,
  from: Date,
  to: Date,
): string {
  const params = new URLSearchParams({
    pDateFrom: fomDate(from),
    pDateTo: fomDate(to),
    pFilial_id: filialId,
    pReport_id: String(reportId),
  });
  return `${base}/P_GetReport_XML?${params.toString()}`;
}

export class FomError extends Error {}

// Older P_GetReport_XML versions only know the v1 reports (1, 2, 4, 5) and lack 6 / 189.
const REPORT_FALLBACKS: Record<FomReportKey, number[]> = {
  organizations: [189],
  catalog: [188],
  stock: [6],
  purchases: [11, 1],
  supplierReturns: [12, 2],
  writeOffs: [3],
  retailSales: [14, 4],
  insuranceSales: [15, 5],
  incomes: [],
  receipts: [],
  stockDocuments: [],
  transfers: [],
  payments: [],
};

export function fomSqlMode(config: FomConfig): boolean {
  return Boolean(config.reportUrl?.startsWith("mssql://") && fomSqlConfig());
}

/** Reads F-APTEKA tables directly (SQL mode only); [] otherwise. */
async function fetchDirect(
  config: FomConfig,
  query: (cfg: FomSqlConfig, timeoutMs: number) => Promise<FomRow[]>,
): Promise<FomRow[]> {
  const sqlCfg = fomSqlMode(config) ? fomSqlConfig() : null;
  if (!sqlCfg) return [];
  try {
    return await query(sqlCfg, Math.max(config.timeoutMs, 300_000));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof FomSqlConnectionError) throw new FomError(`FOM bazasiga ulanib boʻlmadi (${message} — ${config.reportUrl}).`);
    throw new FomError(message);
  }
}

/** Organisations in report-189 shape straight from F-APTEKA's ORG table. */
export const fetchFomOrganizationsDirect = (config: FomConfig) => fetchDirect(config, fomSqlOrganizations);

/** F-APTEKA server clock as `yyyy-mm-ddThh:mm:ss` (local wall-clock), or null outside SQL mode. */
export async function fetchFomSourceNow(config: FomConfig): Promise<string | null> {
  const [row] = await fetchDirect(config, async (cfg, timeoutMs) => [{ T: await fomSqlNow(cfg, timeoutMs) }]);
  return row?.T || null;
}

export type { FomScope };

/** Ids of posted F-APTEKA documents dated from `floor` (see fomSqlRecentDocIds). */
export const fetchFomRecentDocIds = (config: FomConfig, floor: Date) =>
  fetchDirect(config, (cfg, timeoutMs) => fomSqlRecentDocIds(cfg, floor, timeoutMs));

/** Current stock per department and good (see fomSqlStock). */
export const fetchFomStockDirect = (config: FomConfig) => fetchDirect(config, fomSqlStock);

/** Daily money totals per department and payment type (see fomSqlPayments). */
export const fetchFomPaymentsDirect = (config: FomConfig, scope: FomScope) =>
  fetchDirect(config, (cfg, timeoutMs) => fomSqlPayments(cfg, scope, timeoutMs));

/** Retail receipts with their lines and payments (see fomSqlReceiptLines / fomSqlReceiptPayments). */
export const fetchFomReceiptsDirect = async (config: FomConfig, scope: FomScope) => ({
  lines: await fetchDirect(config, (cfg, timeoutMs) => fomSqlReceiptLines(cfg, scope, timeoutMs)),
  payments: await fetchDirect(config, (cfg, timeoutMs) => fomSqlReceiptPayments(cfg, scope, timeoutMs)),
});

/** Supplier receipts into the warehouse, one row per line (see fomSqlPurchases). */
export const fetchFomPurchasesDirect = (config: FomConfig, scope: FomScope) =>
  fetchDirect(config, (cfg, timeoutMs) => fomSqlPurchases(cfg, scope, timeoutMs));

/** Write-offs, supplier returns and inventory documents (see fomSqlStockDocuments). */
export const fetchFomStockDocumentsDirect = (config: FomConfig, scope: FomScope) =>
  fetchDirect(config, (cfg, timeoutMs) => fomSqlStockDocuments(cfg, scope, timeoutMs));

/** Warehouse ↔ pharmacy moves, one row per line (see fomSqlTransfers). */
export const fetchFomTransfersDirect = (config: FomConfig, scope: FomScope) =>
  fetchDirect(config, (cfg, timeoutMs) => fomSqlTransfers(cfg, scope, timeoutMs));

/** Report id to request for a section; null when the connected FOM version has no such report. */
export async function fomReportIdFor(config: FomConfig, key: FomReportKey): Promise<number | null> {
  const sqlCfg = config.reportUrl?.startsWith("mssql://") ? fomSqlConfig() : null;
  if (!sqlCfg) return FOM_REPORTS[key].id || null;
  let info;
  try {
    info = await fomSqlProcInfo(sqlCfg, config.timeoutMs);
  } catch (error) {
    if (error instanceof FomSqlConnectionError) {
      throw new FomError(`FOM bazasiga ulanib boʻlmadi (${error.message} — ${config.reportUrl}).`);
    }
    throw new FomError(error instanceof Error ? error.message : String(error));
  }
  return REPORT_FALLBACKS[key].find((id) => info.reports.size === 0 || info.reports.has(id)) ?? null;
}

const connectionHints: Record<string, string> = {
  ECONNREFUSED: "port yopiq: REPORT.exe ishga tushmagan yoki port notoʻgʻri",
  ECONNRESET: "server ulanishni uzdi",
  ENOTFOUND: "bunday manzil topilmadi",
  EHOSTUNREACH: "serverga yoʻl yoʻq: VPN (Radmin) ulanmagan yoki IP notoʻgʻri",
  ENETUNREACH: "tarmoq mavjud emas: VPN (Radmin) ulanmagan",
  ETIMEDOUT: "server javob bermadi: IP, VPN yoki firewall ni tekshiring",
  UND_ERR_CONNECT_TIMEOUT: "server javob bermadi: IP, VPN yoki firewall ni tekshiring",
};

function connectionReason(error: unknown, config: FomConfig): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return `javob ${Math.round(config.timeoutMs / 1000)} soniyada kelmadi`;
  const cause = error.cause as (Error & { code?: string; errors?: Array<{ code?: string }> }) | undefined;
  const code = cause?.code ?? cause?.errors?.find((e) => e.code)?.code;
  const hint = code ? connectionHints[code] : undefined;
  const address = config.reportUrl ? ` — ${config.reportUrl}` : "";
  if (hint) return `${hint}${address}`;
  return (cause?.message || code || error.message || "nomaʼlum xato") + address;
}

export async function fetchFomReport(
  config: FomConfig,
  reportId: number,
  filialId: string,
  from: Date,
  to: Date,
): Promise<FomRow[]> {
  if (!config.reportUrl) throw new FomError("FOM server manzili sozlanmagan.");
  const sqlCfg = config.reportUrl.startsWith("mssql://") ? fomSqlConfig() : null;
  if (sqlCfg) {
    try {
      return parseFomXml(await execFomSqlReport(sqlCfg, reportId, filialId, from, to, Math.max(config.timeoutMs, 300_000)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof FomSqlConnectionError) throw new FomError(`FOM bazasiga ulanib boʻlmadi (${message} — ${config.reportUrl}).`);
      throw new FomError(message);
    }
  }
  const url = reportUrl(config.reportUrl, reportId, filialId, from, to);
  let response: Response;
  try {
    const headers: Record<string, string> = config.apiToken
      ? { Authorization: `Bearer ${config.apiToken}`, "X-Token": config.apiToken }
      : {};
    response = await fetch(url, { headers, signal: AbortSignal.timeout(config.timeoutMs) });
  } catch (error) {
    throw new FomError(`FOM serveriga ulanib boʻlmadi (${connectionReason(error, config)}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = decodeXml(bytes, response.headers.get("content-type"));
  if (!response.ok) {
    throw new FomError(`FOM serveri ${response.status} qaytardi: ${text.slice(0, 160)}`);
  }
  return parseFomXml(text);
}

export function decodeXml(bytes: Uint8Array, contentType?: string | null): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const declared =
    /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1] ??
    /charset=([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared.toLowerCase()).decode(bytes);
    } catch {
      // unknown label: fall through to detection
    }
  }
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("\uFFFD") ? new TextDecoder("windows-1251").decode(bytes) : utf8;
}

interface XmlNode {
  name: string;
  attrs: FomRow;
  children: XmlNode[];
  text: string;
}

const entityMap: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entityMap[entity.toLowerCase()] ?? match;
  });
}

/**
 * Rows are either attribute records (`<V I="1" N="..."/>`) or elements whose
 * children are simple leaves (`<ROW><G>1</G>...</ROW>`); keys are upper-cased.
 */
export function parseFomXml(xml: string): FomRow[] {
  const cleaned = xml
    .replace(/^\uFEFF/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, data: string) =>
      data.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
    );
  if (!cleaned.trim().startsWith("<")) {
    throw new FomError(`FOM javobi XML emas: ${cleaned.trim().slice(0, 160)}`);
  }
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const token = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>|([^<]+)/g;
  const attr = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let match = token.exec(cleaned); match; match = token.exec(cleaned)) {
    const [, closing, name, rawAttrs, selfClosing, text] = match;
    const top = stack[stack.length - 1];
    if (text !== undefined) {
      top.text += decodeEntities(text);
      continue;
    }
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: XmlNode = { name, attrs: {}, children: [], text: "" };
    for (let a = attr.exec(rawAttrs); a; a = attr.exec(rawAttrs)) {
      node.attrs[a[1].toUpperCase()] = decodeEntities(a[2] ?? a[3] ?? "");
    }
    attr.lastIndex = 0;
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }

  const rows: FomRow[] = [];
  const visit = (node: XmlNode) => {
    if (Object.keys(node.attrs).length >= 2) {
      rows.push(node.attrs);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  if (rows.length > 0) return rows;

  const leafRows = (node: XmlNode) => {
    if (
      node.children.length >= 2 &&
      node.children.every((child) => child.children.length === 0)
    ) {
      rows.push(
        Object.fromEntries(
          node.children.map((child) => [child.name.toUpperCase(), child.text.trim()]),
        ),
      );
      return;
    }
    for (const child of node.children) leafRows(child);
  };
  leafRows(root);
  return rows;
}

export function fomNumber(value: string | undefined): string {
  if (!value) return "0";
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : "0";
}

/** Accepts `2026-05-01T00:00:00` or `01.05.2026`; returns a UTC date or null. */
export function fomDateValue(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (dotted) {
    const [, dd, mm, yyyy, h = "0", m = "0", s = "0"] = dotted;
    return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +h, +m, +s));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (iso) {
    const [, yyyy, mm, dd, h = "0", m = "0", s = "0"] = iso;
    return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +h, +m, +s));
  }
  return null;
}

export function fomDay(value: string | undefined): string | null {
  const parsed = fomDateValue(value);
  if (!parsed || parsed.getUTCFullYear() < 1990 || parsed.getUTCFullYear() > 2100) return null;
  return parsed.toISOString().slice(0, 10);
}
