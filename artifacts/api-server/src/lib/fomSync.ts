import { and, desc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import {
  branchesTable,
  cashAccountsTable,
  counterpartiesTable,
  db,
  expensesTable,
  integrationImportsTable,
  inventoryBalancesTable,
  inventoryMovementsTable,
  moneyTransactionsTable,
  productsTable,
  purchaseItemsTable,
  purchasesTable,
  saleItemsTable,
  salePaymentsTable,
  salesTable,
  stockDocumentsTable,
} from "@workspace/db";
import {
  FOM_REPORTS,
  FomError,
  fetchFomOrganizationsDirect,
  fetchFomPaymentsDirect,
  fetchFomPurchasesDirect,
  fetchFomReceiptsDirect,
  fetchFomReport,
  fetchFomStockDocumentsDirect,
  fetchFomStockDirect,
  fetchFomTransfersDirect,
  fomConfig,
  fomReportIdFor,
  fomSqlMode,
  fomDateValue,
  fomDay,
  fomNumber,
  type FomConfig,
  type FomReportKey,
  type FomRow,
} from "./fomClient";
import {
  centsMoney,
  divideRounded,
  extendedMoney,
  milliQuantity,
  moneyCents,
} from "../routes/financialUtils";
import { logger } from "./logger";
import type { Tx } from "./ledger";

const SOURCE = "fom";
const CHUNK = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReportOutcome {
  rows: number;
  imported: number;
  error: string | null;
  warning?: string | null;
}

export interface SyncDetails {
  trigger: string;
  from: string | null;
  to: string | null;
  filials: string[];
  /** When organisations + catalog were last refreshed successfully. */
  refsAt?: string | null;
  /** When stock balances were last refreshed. */
  stockAt?: string | null;
  /** Work units done / planned in this run (one report window each). */
  progress?: { done: number; total: number };
  reports: Partial<Record<FomReportKey | "site", ReportOutcome>>;
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** FOM sends 6 decimals (e.g. 0.374999); round half-up to milli-units. */
function qtyMilli(value: string | undefined): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(fomNumber(value));
  if (!match) return 0n;
  const fraction = (match[3] ?? "") + "0000";
  let milli = BigInt(match[2]) * 1000n + BigInt(fraction.slice(0, 3));
  if (fraction[3] >= "5") milli += 1n;
  return match[1] === "-" ? -milli : milli;
}

const flag = (value: string | undefined) => value?.trim() === "1" || value?.trim().toLowerCase() === "true";

// ---------------------------------------------------------------- lookups

interface Lookups {
  branches: Map<string, number>;
  products: Map<string, { id: number; cost: string | null }>;
  suppliers: Map<string, { id: number; name: string }>;
  /** Older FOM reports (e.g. purchases v1) identify the supplier by INN instead of its FOM id. */
  suppliersByInn: Map<string, { id: number; name: string }>;
  orgNames: Map<string, string>;
}

async function loadLookups(): Promise<Lookups> {
  const [branches, products, counterparties] = await Promise.all([
    db
      .select({ id: branchesTable.id, fomId: branchesTable.fomId })
      .from(branchesTable)
      .where(and(eq(branchesTable.source, SOURCE), isNotNull(branchesTable.fomId))),
    db
      .select({ id: productsTable.id, fomId: productsTable.fomId, cost: productsTable.costPrice })
      .from(productsTable)
      .where(and(eq(productsTable.source, SOURCE), isNotNull(productsTable.fomId))),
    db
      .select({
        id: counterpartiesTable.id,
        fomId: counterpartiesTable.fomId,
        kind: counterpartiesTable.kind,
        name: counterpartiesTable.name,
        taxId: counterpartiesTable.taxId,
      })
      .from(counterpartiesTable)
      .where(isNotNull(counterpartiesTable.fomId)),
  ]);
  const lookups: Lookups = {
    branches: new Map(branches.map((row) => [row.fomId!, row.id])),
    products: new Map(products.map((row) => [row.fomId!, { id: row.id, cost: row.cost }])),
    suppliers: new Map(),
    suppliersByInn: new Map(),
    orgNames: new Map(),
  };
  for (const row of counterparties) {
    lookups.orgNames.set(row.fomId!, row.name);
    if (row.kind === "supplier") {
      lookups.suppliers.set(row.fomId!, { id: row.id, name: row.name });
      if (row.taxId?.trim()) lookups.suppliersByInn.set(row.taxId.trim(), { id: row.id, name: row.name });
    }
  }
  return lookups;
}

const supplierOf = (lookups: Lookups, orgId: string) =>
  lookups.suppliers.get(orgId) ?? lookups.suppliersByInn.get(orgId);

async function ensureBranches(lookups: Lookups, fomIds: Iterable<string>) {
  const missing = [...new Set(fomIds)].filter((id) => id && !lookups.branches.has(id));
  if (missing.length === 0) return;
  const rows = await db
    .insert(branchesTable)
    .values(missing.map((id) => ({ name: `Filial ${id}`, fomId: id, source: SOURCE })))
    .onConflictDoUpdate({
      target: [branchesTable.source, branchesTable.fomId],
      set: { fomId: sql`excluded.fom_id` },
    })
    .returning({ id: branchesTable.id, fomId: branchesTable.fomId });
  for (const row of rows) lookups.branches.set(row.fomId!, row.id);
}

async function ensureProducts(lookups: Lookups, fomIds: Iterable<string>) {
  const missing = [...new Set(fomIds)].filter((id) => id && !lookups.products.has(id));
  for (const part of chunks(missing)) {
    const rows = await db
      .insert(productsTable)
      .values(part.map((id) => ({ name: `FOM tovar #${id}`, fomId: id, source: SOURCE })))
      .onConflictDoUpdate({
        target: [productsTable.source, productsTable.fomId],
        set: { fomId: sql`excluded.fom_id` },
      })
      .returning({ id: productsTable.id, fomId: productsTable.fomId, cost: productsTable.costPrice });
    for (const row of rows) lookups.products.set(row.fomId!, { id: row.id, cost: row.cost });
  }
}

// ---------------------------------------------------------------- reference data

export async function importOrganizations(lookups: Lookups, rows: FomRow[]): Promise<number> {
  const branchRows = rows.filter((row) => row.I && flag(row.APT));
  if (branchRows.length) {
    const inserted = await db
      .insert(branchesTable)
      .values(
        branchRows.map((row) => {
          const name = row.N?.trim() || `Filial ${row.I}`;
          return { name, fomId: row.I, kind: /склад|sklad|ombor/i.test(name) ? "warehouse" : "pharmacy", source: SOURCE };
        }),
      )
      .onConflictDoUpdate({
        target: [branchesTable.source, branchesTable.fomId],
        set: { name: sql`excluded.name`, kind: sql`excluded.kind` },
      })
      .returning({ id: branchesTable.id, fomId: branchesTable.fomId });
    for (const row of inserted) lookups.branches.set(row.fomId!, row.id);
  }

  let imported = branchRows.length;
  for (const kind of ["supplier", "customer"] as const) {
    const wanted = rows.filter((row) =>
      row.I && (kind === "supplier" ? flag(row.INC) : flag(row.INV) || flag(row.DIS) || flag(row.INS)),
    );
    if (wanted.length === 0) continue;
    const existing = await db
      .select({ id: counterpartiesTable.id, name: counterpartiesTable.name, fomId: counterpartiesTable.fomId })
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.kind, kind));
    const byFom = new Map(existing.filter((row) => row.fomId).map((row) => [row.fomId!, row]));
    const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row]));

    for (const row of wanted) {
      if (byFom.has(row.I)) continue;
      const adopt = byName.get((row.N ?? "").trim().toLowerCase());
      if (adopt && !adopt.fomId) {
        await db.update(counterpartiesTable).set({ fomId: row.I }).where(eq(counterpartiesTable.id, adopt.id));
        adopt.fomId = row.I;
        byFom.set(row.I, adopt);
      }
    }

    const takenNames = new Map(existing.map((row) => [row.name.toLowerCase(), row.fomId]));
    const values = wanted.map((row) => {
      let name = row.N?.trim() || `Kontragent #${row.I}`;
      const owner = takenNames.get(name.toLowerCase());
      if (owner !== undefined && owner !== row.I) name = `${name} (#${row.I})`;
      takenNames.set(name.toLowerCase(), row.I);
      const roles = [
        flag(row.INC) && "yetkazib beruvchi",
        flag(row.INV) && "oluvchi",
        flag(row.DIS) && "diskont",
        flag(row.INS) && "sugʻurta kompaniyasi",
        flag(row.APT) && "filial",
      ].filter(Boolean);
      return {
        name,
        kind,
        fomId: row.I,
        taxId: row.INN?.trim() ?? "",
        note: roles.length ? `FOM: ${roles.join(", ")}` : "FOM",
      };
    });
    for (const part of chunks(values)) {
      const saved = await db
        .insert(counterpartiesTable)
        .values(part)
        .onConflictDoUpdate({
          target: [counterpartiesTable.kind, counterpartiesTable.fomId],
          set: { name: sql`excluded.name`, taxId: sql`excluded.tax_id`, note: sql`excluded.note` },
        })
        .returning({
          id: counterpartiesTable.id,
          fomId: counterpartiesTable.fomId,
          name: counterpartiesTable.name,
          taxId: counterpartiesTable.taxId,
        });
      for (const row of saved) {
        lookups.orgNames.set(row.fomId!, row.name);
        if (kind === "supplier") {
          lookups.suppliers.set(row.fomId!, { id: row.id, name: row.name });
          if (row.taxId?.trim()) lookups.suppliersByInn.set(row.taxId.trim(), { id: row.id, name: row.name });
        }
      }
    }
    imported += values.length;
  }
  for (const row of rows) if (row.I && row.N && !lookups.orgNames.has(row.I)) lookups.orgNames.set(row.I, row.N.trim());
  return imported;
}

export interface CatalogItem {
  fomId: string;
  name: string;
  manufacturer?: string;
  ikpu?: string;
  unit?: string;
  packageCode?: string;
}

export async function importCatalog(lookups: Lookups, items: CatalogItem[]): Promise<number> {
  const unique = new Map<string, CatalogItem>();
  for (const item of items) if (item.fomId && item.name.trim()) unique.set(item.fomId, item);
  for (const part of chunks([...unique.values()])) {
    const saved = await db
      .insert(productsTable)
      .values(
        part.map((item) => ({
          name: item.name.trim(),
          fomId: item.fomId,
          source: SOURCE,
          manufacturer: item.manufacturer?.trim() ?? "",
          ikpu: item.ikpu?.trim() ?? "",
          packageCode: item.packageCode?.trim() ?? "",
          unit: item.unit?.trim() || "dona",
        })),
      )
      .onConflictDoUpdate({
        target: [productsTable.source, productsTable.fomId],
        set: {
          name: sql`excluded.name`,
          manufacturer: sql`coalesce(nullif(excluded.manufacturer, ''), ${productsTable.manufacturer})`,
          ikpu: sql`coalesce(nullif(excluded.ikpu, ''), ${productsTable.ikpu})`,
          packageCode: sql`coalesce(nullif(excluded.package_code, ''), ${productsTable.packageCode})`,
          unit: sql`case when excluded.unit = 'dona' then ${productsTable.unit} else excluded.unit end`,
        },
      })
      .returning({ id: productsTable.id, fomId: productsTable.fomId, cost: productsTable.costPrice });
    for (const row of saved) lookups.products.set(row.fomId!, { id: row.id, cost: row.cost });
  }
  return unique.size;
}

// ---------------------------------------------------------------- stock snapshot

export interface StockBatch {
  branchFomId: string;
  productFomId: string;
  quantity: string;
  retailPrice: string;
  expiry: string | null;
  /** Cost of the whole quantity, when the source knows it (direct SQL stock). */
  costValue?: string;
}

/**
 * Replaces balances of every branch present in `responses`. When several
 * responses contain the same branch only the first one is used, so a report
 * that returns all branches regardless of pFilial_id is not double counted.
 */
export async function importStockSnapshot(
  lookups: Lookups,
  responses: StockBatch[][],
): Promise<number> {
  const owner = new Map<string, number>();
  const batches: StockBatch[] = [];
  responses.forEach((batch, index) => {
    for (const row of batch) {
      const first = owner.get(row.branchFomId);
      if (first === undefined) owner.set(row.branchFomId, index);
      else if (first !== index) continue;
      batches.push(row);
    }
  });
  if (owner.size === 0) return 0;
  await ensureBranches(lookups, owner.keys());
  await ensureProducts(lookups, batches.map((row) => row.productFomId));

  // Direct SQL stock knows each branch's batch cost; then balances carry that exact cost.
  const exactCosts = batches.some((row) => row.costValue);
  const balances = new Map<string, { branchId: number; productId: number; qty: bigint; value: bigint }>();
  const productInfo = new Map<number, { price: bigint; expiry: string | null }>();
  const stockCost = new Map<number, { qty: bigint; value: bigint }>();
  for (const row of batches) {
    const branchId = lookups.branches.get(row.branchFomId)!;
    const productId = lookups.products.get(row.productFomId)!.id;
    const key = `${branchId}:${productId}`;
    const qty = qtyMilli(row.quantity);
    const entry = balances.get(key) ?? { branchId, productId, qty: 0n, value: 0n };
    entry.qty += qty;
    entry.value += moneyCents(fomNumber(row.costValue));
    balances.set(key, entry);
    if (row.costValue && qty > 0n) {
      const cost = stockCost.get(productId) ?? { qty: 0n, value: 0n };
      cost.qty += qty;
      cost.value += moneyCents(fomNumber(row.costValue));
      stockCost.set(productId, cost);
    }
    if (qty > 0n) {
      const price = moneyCents(fomNumber(row.retailPrice));
      const info = productInfo.get(productId) ?? { price: 0n, expiry: null };
      if (price > info.price) info.price = price;
      if (row.expiry && (!info.expiry || row.expiry < info.expiry)) info.expiry = row.expiry;
      productInfo.set(productId, info);
    }
  }

  const costById = new Map([...lookups.products.values()].map((entry) => [entry.id, entry.cost]));
  const stamp = new Date();
  for (const part of chunks([...balances.values()])) {
    await db
      .insert(inventoryBalancesTable)
      .values(
        part.map((row) => ({
          branchId: row.branchId,
          productId: row.productId,
          quantity: milliQuantity(row.qty),
          costPrice: exactCosts
            ? row.qty > 0n ? centsMoney(divideRounded(row.value * 1000n, row.qty)) : null
            : costById.get(row.productId) ?? null,
          source: SOURCE,
          updatedAt: stamp,
        })),
      )
      .onConflictDoUpdate({
        target: [inventoryBalancesTable.branchId, inventoryBalancesTable.productId],
        set: exactCosts
          ? { quantity: sql`excluded.quantity`, costPrice: sql`excluded.cost_price`, source: SOURCE, updatedAt: stamp }
          : { quantity: sql`excluded.quantity`, source: SOURCE, updatedAt: stamp },
      });
  }
  const branchIds = [...owner.keys()].map((id) => lookups.branches.get(id)!);
  await db
    .update(inventoryBalancesTable)
    .set({ quantity: "0", updatedAt: stamp })
    .where(
      and(
        inArray(inventoryBalancesTable.branchId, branchIds),
        lt(inventoryBalancesTable.updatedAt, stamp),
        ne(inventoryBalancesTable.quantity, "0"),
      ),
    );

  for (const part of chunks([...productInfo.entries()])) {
    const values = sql.join(
      part.map(([id, info]) => sql`(${id}::int, ${centsMoney(info.price)}::numeric, ${info.expiry}::date)`),
      sql`, `,
    );
    await db.execute(sql`
      update ${productsTable} as p
      set retail_price = case when v.price > 0 then v.price else p.retail_price end,
          expiry_date = coalesce(v.expiry, p.expiry_date)
      from (values ${values}) as v(id, price, expiry)
      where p.id = v.id`);
  }
  // A product's cost is the weighted cost of the batches on hand across all branches.
  const averages = [...stockCost.entries()].filter(([, cost]) => cost.value > 0n);
  for (const part of chunks(averages)) {
    const values = sql.join(
      part.map(([id, cost]) => sql`(${id}::int, ${centsMoney(divideRounded(cost.value * 1000n, cost.qty))}::numeric)`),
      sql`, `,
    );
    const updated = await db.execute<{ id: number; cost_price: string }>(sql`
      update ${productsTable} as p set cost_price = v.cost
      from (values ${values}) as v(id, cost) where p.id = v.id
      returning p.id, p.cost_price`);
    const costs = new Map(updated.rows.map((row) => [Number(row.id), String(row.cost_price)]));
    for (const entry of lookups.products.values()) {
      const cost = costs.get(entry.id);
      if (cost) entry.cost = cost;
    }
  }
  if (!exactCosts) await syncBalanceCosts();
  return batches.length;
}

async function syncBalanceCosts() {
  await db.execute(sql`
    update ${inventoryBalancesTable} as b
    set cost_price = p.cost_price
    from ${productsTable} as p
    where p.id = b.product_id and p.source = ${SOURCE} and p.cost_price is not null
      and b.cost_price is distinct from p.cost_price`);
}

// ---------------------------------------------------------------- documents

interface Line {
  productFomId: string;
  qty: bigint;
  net: bigint;
  vat: bigint;
  expiry: string | null;
}

interface Doc {
  sourceId: string;
  number: string;
  date: Date;
  branchFomId: string;
  orgId: string;
  invoiceNo: string;
  invoiceDate: string | null;
  person: string;
  category: string;
  lines: Line[];
}

function toLine(row: FomRow): Line | null {
  if (!row.G) return null;
  const qty = qtyMilli(row.Q);
  if (qty === 0n) return null;
  let net = moneyCents(fomNumber(row.SP));
  if (net === 0n) {
    const product = moneyCents(fomNumber(row.P)) * qty;
    net = divideRounded(product, 1000n);
  }
  return { productFomId: row.G, qty, net, vat: moneyCents(fomNumber(row.SN)), expiry: fomDay(row.E) };
}

function groupDocs(
  rows: FomRow[],
  prefix: string,
  filial: string,
  keyOf: (row: FomRow) => string,
): Doc[] {
  const docs = new Map<string, Doc>();
  for (const row of rows) {
    const line = toLine(row);
    const date = fomDateValue(row.D);
    if (!line || !date) continue;
    const key = keyOf(row);
    let doc = docs.get(key);
    if (!doc) {
      doc = {
        sourceId: `${prefix}:${filial}:${key}`,
        number: row.N?.trim() || row.ID?.trim() || "",
        date,
        branchFomId: row.F?.trim() || filial,
        orgId: row.I?.trim() ?? "",
        invoiceNo: row.PN?.trim() ?? "",
        invoiceDate: fomDay(row.PD),
        person: row.NI?.trim() ?? "",
        category: row.CI?.trim() ?? "",
        lines: [],
      };
      docs.set(key, doc);
    }
    doc.lines.push(line);
  }
  return [...docs.values()];
}

const docKey = (row: FomRow) => row.ID?.trim() || `${row.N?.trim() ?? ""}|${row.D?.trim() ?? ""}`;

function lineFigures(line: Line) {
  const sign = line.qty < 0n ? -1n : 1n;
  const qty = line.qty * sign;
  const gross = (line.net + line.vat) * sign;
  const net = line.net * sign;
  const unit = divideRounded(gross * 1000n, qty);
  const vatRate = net > 0n ? Math.round(Number((line.vat * sign * 10000n) / net) / 100) : 0;
  return { qty, gross, unit, vatRate, vat: line.vat * sign };
}

/** Movement ids are `${docSourceId}#${lineIndex}`; `previousLines` holds old line counts per doc. */
async function deleteLineMovements(tx: Tx, previousLines: Map<string, number>) {
  const ids: string[] = [];
  for (const [sourceId, lines] of previousLines) {
    for (let i = 0; i < lines; i++) ids.push(`${sourceId}#${i}`);
  }
  for (const part of chunks(ids, 1000)) {
    await tx
      .delete(inventoryMovementsTable)
      .where(and(eq(inventoryMovementsTable.source, SOURCE), inArray(inventoryMovementsTable.sourceId, part)));
  }
}

function lineCounts(deleted: Array<{ parentId: number }>, sourceIdOf: Map<number, string>) {
  const counts = new Map<string, number>();
  for (const row of deleted) {
    const sourceId = sourceIdOf.get(row.parentId);
    if (sourceId) counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
  }
  return counts;
}

async function insertMovements(tx: Tx, rows: (typeof inventoryMovementsTable.$inferInsert)[]) {
  for (const part of chunks(rows)) await tx.insert(inventoryMovementsTable).values(part);
}

export async function importPurchases(lookups: Lookups, docs: Doc[]): Promise<number> {
  await ensureBranches(lookups, docs.map((doc) => doc.branchFomId));
  await ensureProducts(lookups, docs.flatMap((doc) => doc.lines.map((line) => line.productFomId)));
  const lastCost = new Map<number, { date: number; unit: bigint }>();

  for (const part of chunks(docs, 200)) {
    await db.transaction(async (tx) => {
      const headers = part.map((doc) => {
        const supplier = supplierOf(lookups, doc.orgId);
        const figures = doc.lines.map(lineFigures);
        const total = figures.reduce((sum, line) => sum + line.gross, 0n);
        const vat = figures.reduce((sum, line) => sum + line.vat, 0n);
        return {
          branchId: lookups.branches.get(doc.branchFomId)!,
          counterpartyId: supplier?.id ?? null,
          supplierName: supplier?.name ?? lookups.orgNames.get(doc.orgId) ?? (doc.orgId ? `Kontragent #${doc.orgId}` : "Nomaʼlum yetkazib beruvchi"),
          documentNo: doc.number,
          invoiceNo: doc.invoiceNo,
          invoiceDate: doc.invoiceDate,
          receivedAt: doc.date,
          itemsTotal: centsMoney(total),
          vatAmount: centsMoney(vat),
          totalAmount: centsMoney(total),
          note: "FOM importi",
          createdBy: "FOM",
          source: SOURCE,
          sourceId: doc.sourceId,
        };
      });
      const saved = await tx
        .insert(purchasesTable)
        .values(headers)
        .onConflictDoUpdate({
          target: [purchasesTable.source, purchasesTable.sourceId],
          set: {
            branchId: sql`excluded.branch_id`,
            counterpartyId: sql`excluded.counterparty_id`,
            supplierName: sql`excluded.supplier_name`,
            documentNo: sql`excluded.document_no`,
            invoiceNo: sql`excluded.invoice_no`,
            invoiceDate: sql`excluded.invoice_date`,
            receivedAt: sql`excluded.received_at`,
            itemsTotal: sql`excluded.items_total`,
            vatAmount: sql`excluded.vat_amount`,
            totalAmount: sql`excluded.total_amount`,
          },
        })
        .returning({ id: purchasesTable.id, sourceId: purchasesTable.sourceId });
      const idOf = new Map(saved.map((row) => [row.sourceId!, row.id]));
      const deleted = await tx
        .delete(purchaseItemsTable)
        .where(inArray(purchaseItemsTable.purchaseId, saved.map((row) => row.id)))
        .returning({ parentId: purchaseItemsTable.purchaseId });
      await deleteLineMovements(tx, lineCounts(deleted, new Map(saved.map((row) => [row.id, row.sourceId!]))));

      const items: (typeof purchaseItemsTable.$inferInsert)[] = [];
      const movements: (typeof inventoryMovementsTable.$inferInsert)[] = [];
      for (const [index, doc] of part.entries()) {
        const purchaseId = idOf.get(doc.sourceId)!;
        doc.lines.forEach((line, lineIndex) => {
          const product = lookups.products.get(line.productFomId)!;
          const figures = lineFigures(line);
          const unitCost = centsMoney(figures.unit);
          items.push({
            purchaseId,
            productId: product.id,
            quantity: milliQuantity(figures.qty),
            unitCost,
            vatRate: String(figures.vatRate),
            landedUnitCost: unitCost,
            expiryDate: line.expiry,
          });
          movements.push({
            branchId: headers[index].branchId,
            productId: product.id,
            movementType: "purchase",
            quantity: milliQuantity(figures.qty),
            unitCost,
            documentNo: doc.number,
            note: headers[index].supplierName,
            occurredAt: doc.date,
            source: SOURCE,
            sourceId: `${doc.sourceId}#${lineIndex}`,
          });
          const previous = lastCost.get(product.id);
          if (!previous || previous.date <= doc.date.getTime()) {
            lastCost.set(product.id, { date: doc.date.getTime(), unit: figures.unit });
          }
        });
      }
      for (const itemPart of chunks(items)) await tx.insert(purchaseItemsTable).values(itemPart);
      await insertMovements(tx, movements);
    });
  }

  for (const part of chunks([...lastCost.entries()])) {
    const values = sql.join(
      part.map(([id, cost]) => sql`(${id}::int, ${centsMoney(cost.unit)}::numeric)`),
      sql`, `,
    );
    await db.execute(sql`
      update ${productsTable} as p set cost_price = v.cost
      from (values ${values}) as v(id, cost) where p.id = v.id`);
  }
  for (const entry of lookups.products.values()) {
    const cost = lastCost.get(entry.id);
    if (cost) entry.cost = centsMoney(cost.unit);
  }
  await syncBalanceCosts();
  return docs.length;
}

export async function importSales(
  lookups: Lookups,
  docs: Doc[],
  kind: "retail" | "insurance",
): Promise<number> {
  await ensureBranches(lookups, docs.map((doc) => doc.branchFomId));
  await ensureProducts(lookups, docs.flatMap((doc) => doc.lines.map((line) => line.productFomId)));

  for (const part of chunks(docs, 200)) {
    await db.transaction(async (tx) => {
      const headers = part.map((doc) => {
        const isReturn = doc.lines.reduce((sum, line) => sum + line.net + line.vat, 0n) < 0n;
        const insurer = lookups.orgNames.get(doc.orgId) ?? "";
        return {
          branchId: lookups.branches.get(doc.branchFomId)!,
          // Old P_GetReport_XML (report 4) aggregates per day without a receipt number
          receiptNo: `FOM-${doc.number || doc.date.toISOString().slice(0, 10)}`,
          soldAt: doc.date,
          cashier: "FOM",
          customerName: kind === "insurance" ? [doc.person, insurer].filter(Boolean).join(" · ") : "",
          kind: isReturn ? "return" : "sale",
          paymentType: "other",
          status: "completed",
          note: kind === "insurance"
            ? `Sugʻurta savdosi${doc.category ? ` · ${doc.category}` : ""}`
            : "Chakana savdo (FOM)",
          createdBy: "FOM",
          source: SOURCE,
          sourceId: doc.sourceId,
        };
      });
      const saved = await tx
        .insert(salesTable)
        .values(headers)
        .onConflictDoUpdate({
          target: [salesTable.source, salesTable.sourceId],
          set: {
            branchId: sql`excluded.branch_id`,
            receiptNo: sql`excluded.receipt_no`,
            soldAt: sql`excluded.sold_at`,
            customerName: sql`excluded.customer_name`,
            kind: sql`excluded.kind`,
            note: sql`excluded.note`,
          },
        })
        .returning({ id: salesTable.id, sourceId: salesTable.sourceId });
      const idOf = new Map(saved.map((row) => [row.sourceId!, row.id]));
      const deleted = await tx
        .delete(saleItemsTable)
        .where(inArray(saleItemsTable.saleId, saved.map((row) => row.id)))
        .returning({ parentId: saleItemsTable.saleId });
      await deleteLineMovements(tx, lineCounts(deleted, new Map(saved.map((row) => [row.id, row.sourceId!]))));

      const items: (typeof saleItemsTable.$inferInsert)[] = [];
      const movements: (typeof inventoryMovementsTable.$inferInsert)[] = [];
      for (const [index, doc] of part.entries()) {
        const saleId = idOf.get(doc.sourceId)!;
        doc.lines.forEach((line, lineIndex) => {
          const product = lookups.products.get(line.productFomId)!;
          const figures = lineFigures(line);
          items.push({
            saleId,
            productId: product.id,
            quantity: milliQuantity(figures.qty),
            unitPrice: centsMoney(figures.unit),
            vatRate: String(figures.vatRate),
            costPrice: product.cost,
          });
          movements.push({
            branchId: headers[index].branchId,
            productId: product.id,
            movementType: headers[index].kind === "return" ? "customer_return" : "sale",
            quantity: milliQuantity(figures.qty),
            unitCost: product.cost,
            documentNo: headers[index].receiptNo,
            occurredAt: doc.date,
            source: SOURCE,
            sourceId: `${doc.sourceId}#${lineIndex}`,
          });
        });
      }
      for (const itemPart of chunks(items)) await tx.insert(saleItemsTable).values(itemPart);
      await insertMovements(tx, movements);
    });
  }
  return docs.length;
}

export async function importStockDocuments(
  lookups: Lookups,
  docs: Doc[],
  docType: "supplier_return" | "write_off",
): Promise<number> {
  await ensureBranches(lookups, docs.map((doc) => doc.branchFomId));
  await ensureProducts(lookups, docs.flatMap((doc) => doc.lines.map((line) => line.productFomId)));

  for (const part of chunks(docs, 200)) {
    await db.transaction(async (tx) => {
      const headers = part.map((doc) => {
        const total = doc.lines.reduce((sum, line) => sum + lineFigures(line).gross, 0n);
        const supplier = docType === "supplier_return" ? supplierOf(lookups, doc.orgId) : undefined;
        return {
          docType,
          documentNo: doc.number,
          branchId: lookups.branches.get(doc.branchFomId)!,
          counterpartyId: supplier?.id ?? null,
          counterpartyName:
            docType === "supplier_return"
              ? supplier?.name ?? lookups.orgNames.get(doc.orgId) ?? (doc.orgId ? `Kontragent #${doc.orgId}` : "")
              : "",
          occurredAt: doc.date,
          reason: docType === "write_off" ? "FOM: hisobdan chiqarish" : "FOM: yetkazib beruvchiga qaytarish",
          totalCost: centsMoney(total),
          createdBy: "FOM",
          source: SOURCE,
          sourceId: doc.sourceId,
        };
      });
      const saved = await tx
        .insert(stockDocumentsTable)
        .values(headers)
        .onConflictDoUpdate({
          target: [stockDocumentsTable.source, stockDocumentsTable.sourceId],
          set: {
            documentNo: sql`excluded.document_no`,
            branchId: sql`excluded.branch_id`,
            counterpartyId: sql`excluded.counterparty_id`,
            counterpartyName: sql`excluded.counterparty_name`,
            occurredAt: sql`excluded.occurred_at`,
            totalCost: sql`excluded.total_cost`,
          },
        })
        .returning({ id: stockDocumentsTable.id, sourceId: stockDocumentsTable.sourceId });
      const idOf = new Map(saved.map((row) => [row.sourceId!, row.id]));
      await tx.delete(inventoryMovementsTable).where(inArray(inventoryMovementsTable.documentId, saved.map((row) => row.id)));

      const movements: (typeof inventoryMovementsTable.$inferInsert)[] = [];
      for (const [index, doc] of part.entries()) {
        doc.lines.forEach((line, lineIndex) => {
          const figures = lineFigures(line);
          movements.push({
            branchId: headers[index].branchId,
            productId: lookups.products.get(line.productFomId)!.id,
            documentId: idOf.get(doc.sourceId)!,
            movementType: docType,
            quantity: milliQuantity(figures.qty),
            unitCost: centsMoney(figures.unit),
            documentNo: doc.number,
            note: headers[index].reason,
            occurredAt: doc.date,
            source: SOURCE,
            sourceId: `${doc.sourceId}#${lineIndex}`,
          });
        });
      }
      await insertMovements(tx, movements);
    });
  }
  return docs.length;
}

const transferLabels: Record<string, string> = {
  "13": "Omborga qaytarish (ВОЗВРАТ НА СКЛАД)",
  "15": "Dorixonaga koʻchirish (ПЕРЕМЕЩЕНИЕ В АПТЕКУ)",
  "57": "Dorixonalararo qaytarish (ВОЗВРАТ ДЛЯ АПТЕКИ)",
};

/** Rows from fomSqlTransfers; each document becomes a transfer with paired out/in movements. */
export async function importTransfers(lookups: Lookups, rows: FomRow[]): Promise<number> {
  const docs = new Map<string, { head: FomRow; date: Date; lines: Array<{ productFomId: string; qty: bigint; amount: bigint; unitCost: bigint }> }>();
  for (const row of rows) {
    const date = fomDateValue(row.D);
    const qty = qtyMilli(row.Q);
    if (!row.ID || !row.G || !row.F || !row.T || row.F === row.T || !date || qty <= 0n) continue;
    const amount = moneyCents(fomNumber(row.A));
    const doc = docs.get(row.ID) ?? { head: row, date, lines: [] };
    doc.lines.push({ productFomId: row.G, qty, amount, unitCost: unitFor(amount, qty, moneyCents(fomNumber(row.C))) });
    docs.set(row.ID, doc);
  }
  const list = [...docs.values()];
  await ensureBranches(lookups, list.flatMap((doc) => [doc.head.F, doc.head.T]));
  await ensureProducts(lookups, list.flatMap((doc) => doc.lines.map((line) => line.productFomId)));

  for (const part of chunks(list, 200)) {
    await db.transaction(async (tx) => {
      const headers = part.map(({ head, date, lines }) => {
        const purpose = head.R?.trim() ?? "";
        return {
          docType: "transfer",
          documentNo: head.N?.trim() || head.ID,
          branchId: lookups.branches.get(head.F)!,
          toBranchId: lookups.branches.get(head.T)!,
          occurredAt: date,
          reason: transferLabels[head.DT ?? ""] ?? "FOM: ichki koʻchirish",
          note: /^[*\s]*$/.test(purpose) ? "" : purpose,
          totalCost: centsMoney(lines.reduce((sum, line) => sum + line.amount, 0n)),
          createdBy: "FOM",
          source: SOURCE,
          sourceId: `tr:${head.ID}`,
        };
      });
      const saved = await tx
        .insert(stockDocumentsTable)
        .values(headers)
        .onConflictDoUpdate({
          target: [stockDocumentsTable.source, stockDocumentsTable.sourceId],
          set: {
            documentNo: sql`excluded.document_no`,
            branchId: sql`excluded.branch_id`,
            toBranchId: sql`excluded.to_branch_id`,
            occurredAt: sql`excluded.occurred_at`,
            reason: sql`excluded.reason`,
            note: sql`excluded.note`,
            totalCost: sql`excluded.total_cost`,
          },
        })
        .returning({ id: stockDocumentsTable.id, sourceId: stockDocumentsTable.sourceId });
      const idOf = new Map(saved.map((row) => [row.sourceId!, row.id]));
      await tx.delete(inventoryMovementsTable).where(inArray(inventoryMovementsTable.documentId, saved.map((row) => row.id)));

      const movements: (typeof inventoryMovementsTable.$inferInsert)[] = [];
      part.forEach((doc, index) => {
        const header = headers[index];
        doc.lines.forEach((line, lineIndex) => {
          const common = {
            productId: lookups.products.get(line.productFomId)!.id,
            documentId: idOf.get(header.sourceId)!,
            quantity: milliQuantity(line.qty),
            unitCost: centsMoney(line.unitCost),
            documentNo: header.documentNo,
            note: header.reason,
            occurredAt: doc.date,
            source: SOURCE,
          };
          movements.push(
            { ...common, branchId: header.branchId, toBranchId: header.toBranchId, movementType: "transfer_out", sourceId: `${header.sourceId}#${lineIndex}` },
            { ...common, branchId: header.toBranchId, toBranchId: header.branchId, movementType: "transfer_in", sourceId: `${header.sourceId}#${lineIndex}in` },
          );
        });
      });
      await insertMovements(tx, movements);
    });
  }
  return list.length;
}

/** Where an F-APTEKA cash box (CASHBOX: КАССА, HUMO, UzCard, Click, PayMe, …) books its money. */
interface Channel {
  account: string;
  kind: "cash" | "bank";
  method: string;
}

function channelOf(cashboxId: string | undefined, cashboxName: string | undefined, docType: string | undefined): Channel {
  const name = cashboxName?.trim() ?? "";
  const upper = name.toUpperCase();
  if (cashboxId === "1" || upper === "КАССА") return { account: "Naqd kassa (КАССА)", kind: "cash", method: "cash" };
  const account = !name ? `Kassa #${cashboxId ?? "?"}` : /^\d+$/.test(name) ? `Toʻlov turi ${name}` : name;
  if (/HUMO|UZCARD|VISA|MASTER/.test(upper)) return { account, kind: "bank", method: "card" };
  if (/НАКОП/.test(upper)) return { account, kind: "bank", method: "other" };
  if (docType === "21") return { account, kind: "cash", method: "cash" };
  if (docType === "20") return { account, kind: "bank", method: "card" };
  return { account, kind: "bank", method: "transfer" };
}

const payoutTypes: Record<string, { type: string; note: string }> = {
  "40": { type: "encashment", note: "Inkassatsiya" },
  "52": { type: "supplier_payment", note: "Yetkazib beruvchiga toʻlov" },
  "56": { type: "cash_out", note: "Kassadan chiqim" },
};

const accountIds = new Map<string, number>();

/** The branch's FOM account for a payment channel, created on first use. */
async function fomAccount(lookups: Lookups, branchFomId: string, channel: Channel) {
  const branchId = lookups.branches.get(branchFomId)!;
  const key = `${branchId}:${channel.account}`;
  let id = accountIds.get(key);
  if (id == null) {
    const [row] = await db
      .insert(cashAccountsTable)
      .values({ name: channel.account, kind: channel.kind, branchId, source: SOURCE })
      .onConflictDoUpdate({
        target: [cashAccountsTable.source, cashAccountsTable.branchId, cashAccountsTable.name],
        set: { kind: sql`excluded.kind` },
      })
      .returning({ id: cashAccountsTable.id });
    id = row.id;
    accountIds.set(key, id);
  }
  return id;
}

const FOM_TZ = process.env.FOM_TZ?.trim() || "+05:00";

/** F-APTEKA stores local wall-clock time; `T` is `yyyy-mm-ddThh:mm:ss`. */
function localTime(t: string | undefined, day: string | undefined): Date | null {
  if (t && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t)) return new Date(`${t}${FOM_TZ}`);
  return fomDateValue(day);
}

/**
 * Unit price that makes `qty` (milli-units) times it come out at `amount` cents. PHARMEX keeps
 * three decimals of quantity while F-APTEKA keeps six, so exact line amounts come from SQL and
 * the stored unit figures are derived from them.
 */
function unitFor(amount: bigint, qty: bigint, fallback: bigint) {
  return qty === 0n ? fallback : divideRounded(amount * 1000n, qty);
}

/** Rows from fomSqlReceiptLines / fomSqlReceiptPayments: one sale (or return) per F-APTEKA receipt. */
export async function importReceipts(lookups: Lookups, lines: FomRow[], payments: FomRow[]): Promise<number> {
  type ReceiptLine = { productFomId: string; qty: bigint; unit: bigint; amount: bigint; vatRate: number; costAmount: bigint; cost: bigint };
  const receipts = new Map<string, { head: FomRow; at: Date; lines: ReceiptLine[] }>();
  for (const row of lines) {
    const at = localTime(row.T, row.D);
    // Return receipts (4) carry negative KOL; older sale receipts also hold refunded lines as
    // negative KOL, which stay negative so the receipt total matches F-APTEKA.
    const sign = row.DT === "4" ? -1n : 1n;
    const qty = sign * qtyMilli(row.Q);
    if (!row.ID || !row.G || !row.F || !at || qty === 0n) continue;
    const net = moneyCents(fomNumber(row.P));
    const before = moneyCents(fomNumber(row.P1));
    const vat = moneyCents(fomNumber(row.V));
    const receipt = receipts.get(row.ID) ?? { head: row, at, lines: [] };
    receipt.lines.push({
      productFomId: row.G,
      qty,
      unit: before > net ? before : net,
      amount: sign * moneyCents(fomNumber(row.A)),
      vatRate: net - vat > 0n ? Math.round(Number((vat * 10000n) / (net - vat)) / 100) : 0,
      costAmount: sign * moneyCents(fomNumber(row.CA)),
      cost: moneyCents(fomNumber(row.C)),
    });
    receipts.set(row.ID, receipt);
  }
  const paid = new Map<string, Array<{ channel: Channel; cents: bigint }>>();
  for (const row of payments) {
    const cents = moneyCents(fomNumber(row.S));
    if (!row.ID || cents === 0n) continue;
    const list = paid.get(row.ID) ?? [];
    list.push({ channel: channelOf(row.CB, row.CN, row.DT), cents: cents < 0n ? -cents : cents });
    paid.set(row.ID, list);
  }
  const list = [...receipts.values()];
  await ensureBranches(lookups, list.map((receipt) => receipt.head.F));
  await ensureProducts(lookups, list.flatMap((receipt) => receipt.lines.map((line) => line.productFomId)));
  for (const receipt of list) {
    for (const payment of paid.get(receipt.head.ID) ?? []) await fomAccount(lookups, receipt.head.F, payment.channel);
  }

  for (const part of chunks(list, 300)) {
    await db.transaction(async (tx) => {
      const headers = part.map(({ head, at }) => {
        const methods = paid.get(head.ID) ?? [];
        const main = [...methods].sort((a, b) => (b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : 0))[0];
        return {
          branchId: lookups.branches.get(head.F)!,
          receiptNo: head.N?.trim() || head.ID,
          soldAt: at,
          cashier: "FOM",
          kind: head.DT === "4" ? "return" : "sale",
          paymentType: new Set(methods.map((m) => m.channel.method)).size > 1 ? "mixed" : main?.channel.method ?? "other",
          status: "completed",
          note: head.DT === "4" ? "Qaytarish cheki (FOM)" : "Chek (FOM)",
          createdBy: "FOM",
          source: SOURCE,
          sourceId: `chk:${head.ID}`,
        };
      });
      const saved = await tx
        .insert(salesTable)
        .values(headers)
        .onConflictDoUpdate({
          target: [salesTable.source, salesTable.sourceId],
          set: {
            branchId: sql`excluded.branch_id`,
            receiptNo: sql`excluded.receipt_no`,
            soldAt: sql`excluded.sold_at`,
            kind: sql`excluded.kind`,
            paymentType: sql`excluded.payment_type`,
            note: sql`excluded.note`,
          },
        })
        .returning({ id: salesTable.id, sourceId: salesTable.sourceId });
      const idOf = new Map(saved.map((row) => [row.sourceId!, row.id]));
      const saleIds = saved.map((row) => row.id);
      const deleted = await tx
        .delete(saleItemsTable)
        .where(inArray(saleItemsTable.saleId, saleIds))
        .returning({ parentId: saleItemsTable.saleId });
      await deleteLineMovements(tx, lineCounts(deleted, new Map(saved.map((row) => [row.id, row.sourceId!]))));
      await tx.delete(salePaymentsTable).where(inArray(salePaymentsTable.saleId, saleIds));

      const items: (typeof saleItemsTable.$inferInsert)[] = [];
      const movements: (typeof inventoryMovementsTable.$inferInsert)[] = [];
      const pays: (typeof salePaymentsTable.$inferInsert)[] = [];
      part.forEach((receipt, index) => {
        const header = headers[index];
        const saleId = idOf.get(header.sourceId)!;
        receipt.lines.forEach((line, lineIndex) => {
          const productId = lookups.products.get(line.productFomId)!.id;
          const quantity = milliQuantity(line.qty);
          const unitPrice = centsMoney(line.unit);
          // Discount closes the gap to F-APTEKA's exact line amount (chegirma + quantity rounding).
          const discount = extendedMoney(unitPrice, quantity) - line.amount;
          const unitCost = centsMoney(unitFor(line.costAmount, line.qty, line.cost));
          items.push({
            saleId,
            productId,
            quantity,
            unitPrice,
            discount: centsMoney(discount),
            vatRate: String(line.vatRate),
            costPrice: unitCost,
          });
          movements.push({
            branchId: header.branchId,
            productId,
            movementType: header.kind === "return" ? "customer_return" : "sale",
            quantity,
            unitCost,
            documentNo: header.receiptNo,
            occurredAt: receipt.at,
            source: SOURCE,
            sourceId: `${header.sourceId}#${lineIndex}`,
          });
        });
        for (const payment of paid.get(receipt.head.ID) ?? []) {
          pays.push({
            saleId,
            method: payment.channel.method,
            amount: centsMoney(payment.cents),
            accountId: accountIds.get(`${header.branchId}:${payment.channel.account}`) ?? null,
          });
        }
      });
      for (const itemPart of chunks(items)) await tx.insert(saleItemsTable).values(itemPart);
      await insertMovements(tx, movements);
      for (const payPart of chunks(pays)) await tx.insert(salePaymentsTable).values(payPart);
    });
  }
  return list.length;
}

/** Rows from fomSqlPurchases: one purchase per INCOME document, supplier by ORG id. */
export async function importDirectPurchases(lookups: Lookups, rows: FomRow[]): Promise<number> {
  type PurchaseLine = { productFomId: string; qty: bigint; amount: bigint; vat: bigint; unit: bigint; expiry: string | null };
  const docs = new Map<string, { head: FomRow; date: Date; lines: PurchaseLine[] }>();
  for (const row of rows) {
    const date = fomDateValue(row.D);
    const qty = qtyMilli(row.Q);
    if (!row.ID || !row.G || !row.F || !date || qty === 0n) continue;
    const doc = docs.get(row.ID) ?? { head: row, date, lines: [] };
    doc.lines.push({
      productFomId: row.G,
      qty,
      amount: moneyCents(fomNumber(row.A)),
      vat: moneyCents(fomNumber(row.VA)),
      unit: moneyCents(fomNumber(row.C)),
      expiry: fomDay(row.E),
    });
    docs.set(row.ID, doc);
  }
  const list = [...docs.values()];
  await ensureBranches(lookups, list.map((doc) => doc.head.F));
  await ensureProducts(lookups, list.flatMap((doc) => doc.lines.map((line) => line.productFomId)));
  const lastCost = new Map<number, { date: number; unit: string }>();

  for (const part of chunks(list, 200)) {
    await db.transaction(async (tx) => {
      const headers = part.map(({ head, date, lines }) => {
        const supplier = supplierOf(lookups, head.O ?? "");
        const total = lines.reduce((sum, line) => sum + line.amount, 0n);
        const due = fomDay(head.DUE);
        return {
          branchId: lookups.branches.get(head.F)!,
          counterpartyId: supplier?.id ?? null,
          supplierName: supplier?.name ?? lookups.orgNames.get(head.O ?? "") ?? (head.O ? `Kontragent #${head.O}` : "Nomaʼlum yetkazib beruvchi"),
          documentNo: head.N?.trim() || head.ID,
          invoiceNo: head.PN?.trim() ?? "",
          invoiceDate: fomDay(head.PD),
          receivedAt: date,
          itemsTotal: centsMoney(total),
          vatAmount: centsMoney(lines.reduce((sum, line) => sum + line.vat, 0n)),
          totalAmount: centsMoney(total),
          dueDate: due && due > (fomDay(head.D) ?? "") ? due : null,
          note: head.R?.trim() || "FOM kirimi",
          createdBy: "FOM",
          source: SOURCE,
          sourceId: `inc:${head.ID}`,
        };
      });
      const saved = await tx
        .insert(purchasesTable)
        .values(headers)
        .onConflictDoUpdate({
          target: [purchasesTable.source, purchasesTable.sourceId],
          set: {
            branchId: sql`excluded.branch_id`,
            counterpartyId: sql`excluded.counterparty_id`,
            supplierName: sql`excluded.supplier_name`,
            documentNo: sql`excluded.document_no`,
            invoiceNo: sql`excluded.invoice_no`,
            invoiceDate: sql`excluded.invoice_date`,
            receivedAt: sql`excluded.received_at`,
            itemsTotal: sql`excluded.items_total`,
            vatAmount: sql`excluded.vat_amount`,
            totalAmount: sql`excluded.total_amount`,
            dueDate: sql`excluded.due_date`,
            note: sql`excluded.note`,
          },
        })
        .returning({ id: purchasesTable.id, sourceId: purchasesTable.sourceId });
      const idOf = new Map(saved.map((row) => [row.sourceId!, row.id]));
      const deleted = await tx
        .delete(purchaseItemsTable)
        .where(inArray(purchaseItemsTable.purchaseId, saved.map((row) => row.id)))
        .returning({ parentId: purchaseItemsTable.purchaseId });
      await deleteLineMovements(tx, lineCounts(deleted, new Map(saved.map((row) => [row.id, row.sourceId!]))));

      const items: (typeof purchaseItemsTable.$inferInsert)[] = [];
      const movements: (typeof inventoryMovementsTable.$inferInsert)[] = [];
      part.forEach((doc, index) => {
        const header = headers[index];
        const purchaseId = idOf.get(header.sourceId)!;
        doc.lines.forEach((line, lineIndex) => {
          const product = lookups.products.get(line.productFomId)!;
          const quantity = milliQuantity(line.qty);
          const unitCost = centsMoney(line.unit);
          const net = line.amount - line.vat;
          items.push({
            purchaseId,
            productId: product.id,
            quantity,
            unitCost,
            discount: centsMoney(extendedMoney(unitCost, quantity) - line.amount),
            vatRate: String(net > 0n ? Math.round(Number((line.vat * 10000n) / net) / 100) : 0),
            landedUnitCost: centsMoney(unitFor(line.amount, line.qty, line.unit)),
            expiryDate: line.expiry,
          });
          movements.push({
            branchId: header.branchId,
            productId: product.id,
            movementType: "purchase",
            quantity,
            unitCost,
            documentNo: header.documentNo,
            note: header.supplierName,
            occurredAt: doc.date,
            source: SOURCE,
            sourceId: `${header.sourceId}#${lineIndex}`,
          });
          const previous = lastCost.get(product.id);
          if (!previous || previous.date <= doc.date.getTime()) lastCost.set(product.id, { date: doc.date.getTime(), unit: unitCost });
        });
      });
      for (const itemPart of chunks(items)) await tx.insert(purchaseItemsTable).values(itemPart);
      await insertMovements(tx, movements);
    });
  }
  // Products with no stock left keep the cost of their latest receipt; stocked ones get the
  // weighted batch cost from the stock step.
  for (const part of chunks([...lastCost.entries()])) {
    const values = sql.join(part.map(([id, cost]) => sql`(${id}::int, ${cost.unit}::numeric)`), sql`, `);
    await db.execute(sql`
      update ${productsTable} as p set cost_price = v.cost
      from (values ${values}) as v(id, cost)
      where p.id = v.id and not exists (
        select 1 from ${inventoryBalancesTable} b where b.product_id = p.id and b.quantity > 0)`);
  }
  return list.length;
}

const directDocs: Record<string, { docType: string; movement: string; reason: string; expense?: string }> = {
  "11": { docType: "write_off", movement: "write_off", reason: "Hisobdan chiqarish (СПИСАНИЕ ТОВАРОВ)", expense: "Tovar hisobdan chiqarish" },
  "58": { docType: "write_off", movement: "write_off", reason: "Muddati oʻtgan tovar (СПИСАНИЕ ПРОСРОЧЕНОГО)", expense: "Tovar hisobdan chiqarish" },
  "12": { docType: "supplier_return", movement: "supplier_return", reason: "Yetkazib beruvchiga qaytarish (ВОЗВРАТ ПОСТАВЩИКУ)" },
  "17": { docType: "supplier_return", movement: "supplier_return", reason: "Muddati oʻtgan tovar qaytarildi (ВОЗВРАТ ПРОСРОЧЕНОГО)" },
  "6": { docType: "inventory_count", movement: "inventory_shortage", reason: "Inventarizatsiya kamomadi (НЕДОСТАЧА)", expense: "Inventarizatsiya kamomadi" },
  "9": { docType: "inventory_count", movement: "inventory_shortage", reason: "Inventarizatsiya kamomadi (ИНВЕНТАРИЗАЦИЯ АПТЕКИ)", expense: "Inventarizatsiya kamomadi" },
  "1009": { docType: "inventory_count", movement: "inventory_surplus", reason: "Inventarizatsiya ortiqchasi (ИНВЕНТАРИЗАЦИЯ АПТЕКИ)" },
};

/** Rows from fomSqlStockDocuments; write-offs and shortages are also booked as expenses. */
export async function importDirectStockDocuments(lookups: Lookups, rows: FomRow[]): Promise<number> {
  const docs = new Map<string, { head: FomRow; date: Date; lines: Array<{ productFomId: string; qty: bigint; amount: bigint; unitCost: bigint }> }>();
  for (const row of rows) {
    const date = fomDateValue(row.D);
    let qty = qtyMilli(row.Q);
    let amount = moneyCents(fomNumber(row.A));
    if (qty < 0n) qty = -qty;
    if (amount < 0n) amount = -amount;
    if (!row.K || !row.G || !row.F || !date || qty === 0n || !directDocs[row.DT ?? ""]) continue;
    const doc = docs.get(row.K) ?? { head: row, date, lines: [] };
    doc.lines.push({ productFomId: row.G, qty, amount, unitCost: unitFor(amount, qty, moneyCents(fomNumber(row.C))) });
    docs.set(row.K, doc);
  }
  const list = [...docs.values()];
  await ensureBranches(lookups, list.map((doc) => doc.head.F));
  await ensureProducts(lookups, list.flatMap((doc) => doc.lines.map((line) => line.productFomId)));

  for (const part of chunks(list, 200)) {
    await db.transaction(async (tx) => {
      const headers = part.map(({ head, date, lines }) => {
        const spec = directDocs[head.DT!]!;
        const supplier = spec.docType === "supplier_return" ? supplierOf(lookups, head.O ?? "") : undefined;
        const purpose = head.R?.trim() ?? "";
        return {
          docType: spec.docType,
          documentNo: head.N?.trim() || head.K,
          branchId: lookups.branches.get(head.F)!,
          counterpartyId: supplier?.id ?? null,
          counterpartyName: spec.docType === "supplier_return" ? supplier?.name ?? lookups.orgNames.get(head.O ?? "") ?? "" : "",
          occurredAt: date,
          reason: spec.reason,
          note: /^[*\s]*$/.test(purpose) ? "" : purpose,
          totalCost: centsMoney(
            spec.movement === "inventory_surplus" ? 0n : lines.reduce((sum, line) => sum + line.amount, 0n),
          ),
          createdBy: "FOM",
          source: SOURCE,
          sourceId: `doc:${head.K}`,
        };
      });
      const saved = await tx
        .insert(stockDocumentsTable)
        .values(headers)
        .onConflictDoUpdate({
          target: [stockDocumentsTable.source, stockDocumentsTable.sourceId],
          set: {
            documentNo: sql`excluded.document_no`,
            branchId: sql`excluded.branch_id`,
            counterpartyId: sql`excluded.counterparty_id`,
            counterpartyName: sql`excluded.counterparty_name`,
            occurredAt: sql`excluded.occurred_at`,
            reason: sql`excluded.reason`,
            note: sql`excluded.note`,
            totalCost: sql`excluded.total_cost`,
          },
        })
        .returning({ id: stockDocumentsTable.id, sourceId: stockDocumentsTable.sourceId });
      const idOf = new Map(saved.map((row) => [row.sourceId!, row.id]));
      await tx.delete(inventoryMovementsTable).where(inArray(inventoryMovementsTable.documentId, saved.map((row) => row.id)));

      const movements: (typeof inventoryMovementsTable.$inferInsert)[] = [];
      const expenses: (typeof expensesTable.$inferInsert)[] = [];
      part.forEach((doc, index) => {
        const header = headers[index];
        const spec = directDocs[doc.head.DT!]!;
        doc.lines.forEach((line, lineIndex) => {
          movements.push({
            branchId: header.branchId,
            productId: lookups.products.get(line.productFomId)!.id,
            documentId: idOf.get(header.sourceId)!,
            movementType: spec.movement,
            quantity: milliQuantity(line.qty),
            unitCost: centsMoney(line.unitCost),
            documentNo: header.documentNo,
            note: header.reason,
            occurredAt: doc.date,
            source: SOURCE,
            sourceId: `${header.sourceId}#${lineIndex}`,
          });
        });
        if (spec.expense && moneyCents(header.totalCost) > 0n) {
          expenses.push({
            date: doc.head.D!,
            branchId: header.branchId,
            category: spec.expense,
            description: `${header.documentNo}: ${header.reason}`,
            amount: header.totalCost,
            source: SOURCE,
            sourceId: `stock-document:${header.sourceId}`,
            status: "confirmed",
          });
        }
      });
      await insertMovements(tx, movements);
      for (const expensePart of chunks(expenses)) {
        await tx
          .insert(expensesTable)
          .values(expensePart)
          .onConflictDoUpdate({
            target: [expensesTable.source, expensesTable.sourceId],
            set: {
              date: sql`excluded.date`,
              branchId: sql`excluded.branch_id`,
              category: sql`excluded.category`,
              description: sql`excluded.description`,
              amount: sql`excluded.amount`,
            },
          });
      }
    });
  }
  return list.length;
}

/** Rows from fomSqlPayments: one money transaction per day, department and cash box. */
export async function importPayments(lookups: Lookups, rows: FomRow[]): Promise<number> {
  const usable = rows.filter((row) => row.F && (row.DIR === "in" || payoutTypes[row.DT ?? ""]) && fomDateValue(row.D));
  await ensureBranches(lookups, usable.map((row) => row.F));

  const values: (typeof moneyTransactionsTable.$inferInsert)[] = [];
  for (const row of usable) {
    const channel = channelOf(row.CB, row.CN, row.DT);
    const payout = row.DIR === "out" ? payoutTypes[row.DT!]! : null;
    const spec = payout
      ? { type: payout.type, category: "", note: payout.note }
      : { type: "sale", category: channel.method, note: `${channel.account} orqali tushum` };
    let cents = moneyCents(fomNumber(row.S));
    if (cents === 0n) continue;
    let direction = row.DIR === "out" ? "out" : "in";
    // A day where refunds outweigh receipts nets to a negative sum.
    if (cents < 0n) {
      cents = -cents;
      direction = direction === "in" ? "out" : "in";
    }
    values.push({
      date: fomDateValue(row.D)!,
      type: spec.type,
      category: spec.category,
      amount: centsMoney(cents),
      direction,
      accountId: await fomAccount(lookups, row.F, channel),
      branchId: lookups.branches.get(row.F)!,
      documentNo: `FOM-${row.D}`,
      note: `${spec.note} (FOM, ${row.C} ta)`,
      createdBy: "FOM",
      source: SOURCE,
      sourceId: `pay:${row.DIR}:${row.CB}:${row.DT}:${row.F}:${row.D}`,
    });
  }
  for (const part of chunks(values)) {
    await db
      .insert(moneyTransactionsTable)
      .values(part)
      .onConflictDoUpdate({
        target: [moneyTransactionsTable.source, moneyTransactionsTable.sourceId],
        set: {
          date: sql`excluded.date`,
          amount: sql`excluded.amount`,
          direction: sql`excluded.direction`,
          accountId: sql`excluded.account_id`,
          branchId: sql`excluded.branch_id`,
          note: sql`excluded.note`,
        },
      });
  }
  return values.length;
}

// ---------------------------------------------------------------- orchestration

let running: Promise<SyncDetails> | null = null;
/** Set while the import row is being created, so two ticks cannot both pass the `running` check. */
let starting = false;

export function fomSyncRunning() {
  return running != null;
}

function windows(from: Date, to: Date): Array<[Date, Date]> {
  const result: Array<[Date, Date]> = [];
  let start = from;
  while (start <= to) {
    const end = new Date(Math.min(to.getTime(), start.getTime() + 30 * DAY_MS));
    result.push([start, end]);
    start = new Date(end.getTime() + DAY_MS);
  }
  return result;
}

function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function previousSuccess(): Promise<SyncDetails | null> {
  const [last] = await db
    .select({ details: integrationImportsTable.details })
    .from(integrationImportsTable)
    .where(and(eq(integrationImportsTable.integration, "fom"), eq(integrationImportsTable.status, "success")))
    .orderBy(desc(integrationImportsTable.startedAt))
    .limit(1);
  try {
    return last?.details ? (JSON.parse(last.details) as SyncDetails) : null;
  } catch {
    return null;
  }
}

/** Incremental start: two days before the previous successful range end (late edits in FOM). */
function defaultFrom(config: FomConfig, to: Date, previous: SyncDetails | null): Date {
  if (previous?.to) {
    return new Date(Math.max(new Date(previous.to).getTime() - 2 * DAY_MS, to.getTime() - 365 * DAY_MS));
  }
  return new Date(to.getTime() - config.initialDays * DAY_MS);
}

const REFERENCE_REPORTS: FomReportKey[] = ["organizations", "catalog"];

function refsAreFresh(config: FomConfig, previous: SyncDetails | null): boolean {
  if (!previous?.refsAt) return false;
  if (REFERENCE_REPORTS.some((key) => !previous.reports[key] || previous.reports[key]?.error)) return false;
  return Date.now() - new Date(previous.refsAt).getTime() < config.refsIntervalMinutes * 60_000;
}

function sortIds(ids: Iterable<string>): string[] {
  return [...new Set([...ids].map((id) => id.trim()).filter(Boolean))].sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b),
  );
}

export interface SyncOptions {
  from?: Date;
  to?: Date;
  trigger: string;
}

/** Starts a sync in the background; resolves once the import row exists. */
export async function startFomSync(options: SyncOptions): Promise<{ started: boolean; message: string }> {
  const config = fomConfig();
  if (!config.reportUrl) return { started: false, message: "FOM server manzili sozlanmagan (Sozlamalar → FOM ulanishi)." };
  if (running || starting) return { started: false, message: "Sinxronlash allaqachon bajarilmoqda." };
  starting = true;
  try {
    const [row] = await db
      .insert(integrationImportsTable)
      .values({ integration: "fom", status: "running", message: "Sinxronlash boshlandi…" })
      .returning({ id: integrationImportsTable.id });
    // Auto sync runs every few seconds; keep one day of history plus the last success.
    await db.execute(sql`
      delete from ${integrationImportsTable}
      where integration = 'fom' and started_at < now() - interval '1 day'
        and id <> coalesce((select max(id) from ${integrationImportsTable} where integration = 'fom' and status = 'success'), 0)`);
    running = runFomSync(config, options, row.id).finally(() => {
      running = null;
    });
  } finally {
    starting = false;
  }
  running.catch((error) => logger.error({ err: error }, "FOM sync failed"));
  return { started: true, message: "Sinxronlash boshlandi. Holat shu sahifada yangilanadi." };
}

async function runFomSync(config: FomConfig, options: SyncOptions, importId: number): Promise<SyncDetails> {
  const previous = await previousSuccess();
  const to = utcDay(options.to ?? new Date());
  const from = utcDay(options.from ?? defaultFrom(config, to, previous));
  const details: SyncDetails = {
    trigger: options.trigger,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    filials: [],
    refsAt: null,
    reports: {},
  };
  const lookups = await loadLookups();
  let fatal: string | null = null;
  const skipRefs = options.trigger === "auto" && refsAreFresh(config, previous);

  const progress = async (message: string) => {
    await db
      .update(integrationImportsTable)
      .set({ message, details: JSON.stringify(details) })
      .where(eq(integrationImportsTable.id, importId));
  };

  // Progress: refs and stock count as one unit each; dated work is planned once filials are known.
  // Until filials are known the dated work is estimated from the branches already imported.
  let estimated =
    windows(from, to).length *
    (fomSqlMode(config) ? 2 * Math.max(1, lookups.branches.size) + 120 : 5 * Math.max(1, lookups.branches.size));
  details.progress = { done: 0, total: (skipRefs ? 0 : 2) + 1 + estimated };
  let lastWrite = 0;
  const percent = () => Math.min(99, Math.floor((details.progress!.done * 100) / Math.max(1, details.progress!.total)));
  const plan = (units: number) => {
    details.progress!.total += units - estimated;
    estimated = 0;
  };
  const tick = async (label: string, weight = 1) => {
    details.progress!.done += weight;
    if (Date.now() - lastWrite < 2000) return;
    lastWrite = Date.now();
    await progress(`${label} · ${percent()}%`);
  };

  const isConnectionError = (error: unknown) =>
    error instanceof FomError && /ulanib boʻlmadi|soniyada kelmadi/.test(error.message);

  type Work = (warn: (message: string) => void) => Promise<{ rows: number; imported: number }>;
  const run = async (key: FomReportKey, work: Work) => {
    if (fatal) {
      details.reports[key] = { rows: 0, imported: 0, error: "Oʻtkazib yuborildi: server bilan aloqa yoʻq.", warning: null };
      return;
    }
    await progress(`${FOM_REPORTS[key].label} yuklanmoqda… · ${percent()}%`);
    lastWrite = Date.now();
    const warnings: string[] = [];
    try {
      const result = await work((message) => warnings.push(message));
      if (key === "organizations" || key === "catalog" || key === "stock") details.progress!.done += 1;
      details.reports[key] = { ...result, error: null, warning: warnings.length ? warnings.join("; ").slice(0, 400) : null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      details.reports[key] = { rows: 0, imported: 0, error: message, warning: null };
      if (isConnectionError(error)) fatal = message;
      logger.warn({ err: error, report: key }, "FOM report import failed");
    }
  };

  const fetchReport = async (key: FomReportKey, filial: string, rangeFrom = from, rangeTo = to) => {
    const id = await fomReportIdFor(config, key);
    return id == null ? [] : fetchFomReport(config, id, filial, rangeFrom, rangeTo);
  };

  /** Runs `fetch` for every filial; one filial failing does not stop the others. */
  const perFilial = async <T>(warn: (message: string) => void, fetch: (filial: string) => Promise<T>) => {
    const results: Array<{ filial: string; value: T }> = [];
    const failed: string[] = [];
    for (const filial of details.filials) {
      try {
        results.push({ filial, value: await fetch(filial) });
      } catch (error) {
        if (isConnectionError(error)) throw error;
        failed.push(filial);
        warn(`filial ${filial}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (results.length === 0 && failed.length > 0) {
      throw new FomError(`Hech bir filial boʻyicha maʼlumot olinmadi (${failed.join(", ")}).`);
    }
    return results;
  };

  const firstFilial = config.filialIds[0] ?? "1";
  let orgRows: FomRow[] = [];
  if (skipRefs) {
    for (const key of REFERENCE_REPORTS) details.reports[key] = previous!.reports[key];
    details.refsAt = previous!.refsAt;
  } else {
    await run("organizations", async () => {
      orgRows = await fetchReport("organizations", firstFilial);
      // Versions without report 189: read F-APTEKA's ORG table directly (SQL mode), else one named branch.
      if (orgRows.length === 0 && (await fomReportIdFor(config, "organizations")) == null) {
        orgRows = await fetchFomOrganizationsDirect(config);
      }
      if (orgRows.length === 0 && (await fomReportIdFor(config, "organizations")) == null) {
        orgRows = (config.filialIds.length ? config.filialIds : [firstFilial]).map((id) => ({
          I: id,
          N: process.env.FOM_BRANCH_NAME?.trim() || `Filial ${id}`,
          APT: "1",
        }));
      }
      return { rows: orgRows.length, imported: await importOrganizations(lookups, orgRows) };
    });
    await run("catalog", async () => {
      const rows = await fetchReport("catalog", firstFilial);
      const imported = await importCatalog(
        lookups,
        rows.map((row) => ({ fomId: row.I, name: row.N ?? "", manufacturer: row.P, unit: row.E, ikpu: row.C })),
      );
      return { rows: rows.length, imported };
    });
    if (!details.reports.organizations?.error && !details.reports.catalog?.error) {
      details.refsAt = new Date().toISOString();
    }
  }

  // Every filial: configured ids, organisations flagged APT, and FOM branches already known.
  details.filials = sortIds([
    ...config.filialIds,
    ...orgRows.filter((row) => flag(row.APT)).map((row) => row.I),
    ...lookups.branches.keys(),
  ]);
  if (details.filials.length === 0) details.filials = [firstFilial];

  // The 15-second auto runs refresh stock only every FOM_STOCK_INTERVAL_MIN (a heavy query on the pharmacy server).
  const stockEveryMs = (Number(process.env.FOM_STOCK_INTERVAL_MIN) || 5) * 60_000;
  const stockFresh =
    options.trigger === "auto" &&
    !!previous?.stockAt &&
    !!previous.reports.stock &&
    !previous.reports.stock.error &&
    Date.now() - new Date(previous.stockAt).getTime() < stockEveryMs;
  if (stockFresh) {
    details.reports.stock = previous!.reports.stock;
    details.stockAt = previous!.stockAt;
    details.progress.done += 1;
  } else await run("stock", async (warn) => {
    details.stockAt = new Date().toISOString();
    if (fomSqlMode(config) && (await fomReportIdFor(config, "stock")) == null) {
      const rows = await fetchFomStockDirect(config);
      const batches = rows
        .filter((row) => row.F && row.G)
        .map((row) => ({
          branchFomId: row.F,
          productFomId: row.G,
          quantity: row.Q,
          retailPrice: row.P,
          expiry: fomDay(row.E),
          costValue: row.C,
        }));
      details.filials = sortIds([...details.filials, ...batches.map((row) => row.branchFomId)]);
      return { rows: rows.length, imported: await importStockSnapshot(lookups, [batches]) };
    }
    const results = await perFilial(warn, (filial) => fetchReport("stock", filial));
    const responses = results.map(({ filial, value }) =>
      value
        .filter((row) => row.G)
        .map((row) => ({
          branchFomId: row.O?.trim() || filial,
          productFomId: row.G,
          quantity: row.Q,
          retailPrice: row.P,
          expiry: fomDay(row.E),
        })),
    );
    // Branches that only show up as O values in stock become filials for the dated reports too.
    details.filials = sortIds([...details.filials, ...responses.flat().map((row) => row.branchFomId)]);
    const rows = results.reduce((sum, { value }) => sum + value.length, 0);
    return { rows, imported: await importStockSnapshot(lookups, responses) };
  });

  const sqlMode = fomSqlMode(config);
  const dated: Array<{ key: FomReportKey; prefix: string; keyOf: (row: FomRow) => string; save: (docs: Doc[]) => Promise<number> }> = [
    { key: "purchases", prefix: "p", keyOf: docKey, save: (docs) => importPurchases(lookups, docs) },
    { key: "supplierReturns", prefix: "sr", keyOf: docKey, save: (docs) => importStockDocuments(lookups, docs, "supplier_return") },
    { key: "writeOffs", prefix: "wo", keyOf: (row) => fomDay(row.D) ?? row.D ?? "", save: (docs) => importStockDocuments(lookups, docs, "write_off") },
    { key: "retailSales", prefix: "rs", keyOf: docKey, save: (docs) => importSales(lookups, docs, "retail") },
    { key: "insuranceSales", prefix: "is", keyOf: docKey, save: (docs) => importSales(lookups, docs, "insurance") },
  ];
  // SQL mode reads receipts and stock documents per document with batch costs instead of these
  // procedure reports (they aggregate per day and carry no cost).
  const replacedBySql = new Set<FomReportKey>(["purchases", "supplierReturns", "writeOffs", "retailSales"]);
  const procReports = dated.filter((report) => !(sqlMode && replacedBySql.has(report.key)));
  // `weight`: rough cost of one 30-day window relative to one procedure report call.
  const direct: Array<{ key: FomReportKey; weight: number; load: (start: Date, end: Date) => Promise<{ rows: number; imported: number }> }> = sqlMode
    ? [
        {
          key: "incomes",
          weight: 5,
          load: async (start, end) => {
            const data = await fetchFomPurchasesDirect(config, start, end);
            return { rows: data.length, imported: await importDirectPurchases(lookups, data) };
          },
        },
        {
          key: "receipts",
          weight: 100,
          load: async (start, end) => {
            const data = await fetchFomReceiptsDirect(config, start, end);
            return { rows: data.lines.length, imported: await importReceipts(lookups, data.lines, data.payments) };
          },
        },
        {
          key: "stockDocuments",
          weight: 3,
          load: async (start, end) => {
            const data = await fetchFomStockDocumentsDirect(config, start, end);
            return { rows: data.length, imported: await importDirectStockDocuments(lookups, data) };
          },
        },
        {
          key: "transfers",
          weight: 14,
          load: async (start, end) => {
            const data = await fetchFomTransfersDirect(config, start, end);
            return { rows: data.length, imported: await importTransfers(lookups, data) };
          },
        },
        {
          key: "payments",
          weight: 3,
          load: async (start, end) => {
            const data = await fetchFomPaymentsDirect(config, start, end);
            return { rows: data.length, imported: await importPayments(lookups, data) };
          },
        },
      ]
    : [];
  const ranges = windows(from, to);
  plan(
    procReports.length * details.filials.length * ranges.length +
      direct.reduce((sum, step) => sum + step.weight, 0) * ranges.length,
  );

  for (const report of procReports) {
    await run(report.key, async (warn) => {
      let rows = 0;
      let imported = 0;
      await perFilial(warn, async (filial) => {
        for (const [start, end] of ranges) {
          const data = await fetchReport(report.key, filial, start, end);
          rows += data.length;
          imported += await report.save(groupDocs(data, report.prefix, filial, report.keyOf));
          await tick(FOM_REPORTS[report.key].label);
        }
      });
      return { rows, imported };
    });
  }
  for (const step of direct) {
    await run(step.key, async () => {
      let rows = 0;
      let imported = 0;
      for (const [start, end] of ranges) {
        const result = await step.load(start, end);
        rows += result.rows;
        imported += result.imported;
        await tick(`${FOM_REPORTS[step.key].label} (${fomDay(end.toISOString())} gacha)`, step.weight);
      }
      return { rows, imported };
    });
  }

  const fetched = Object.entries(details.reports)
    .filter(([key]) => !(skipRefs && REFERENCE_REPORTS.includes(key as FomReportKey)))
    .map(([, outcome]) => outcome);
  details.progress.done = details.progress.total;
  const errors = fetched.filter((outcome) => outcome?.error);
  const total = fetched.reduce((sum, outcome) => sum + (outcome?.imported ?? 0), 0);
  const status = errors.length === fetched.length ? "error" : "success";
  const scope = `${details.filials.length} filial, ${details.from} — ${details.to}`;
  const message = fatal
    ? fatal
    : errors.length
      ? `${fetched.length - errors.length}/${fetched.length} hisobot yuklandi, ${errors.length} tasida xatolik (${scope}).`
      : `${fetched.length} hisobot yuklandi: ${total.toLocaleString("ru-RU")} yozuv (${scope}).`;
  await db
    .update(integrationImportsTable)
    .set({ status, message, importedRecords: total, completedAt: new Date(), details: JSON.stringify(details) })
    .where(eq(integrationImportsTable.id, importId));
  return details;
}

/** Test call: reads the organisations reference (small, undated). */
export async function testFomConnection(): Promise<{ ok: boolean; message: string }> {
  const config = fomConfig();
  if (!config.reportUrl) return { ok: false, message: "FOM server manzili sozlanmagan (Sozlamalar → FOM ulanishi)." };
  try {
    const today = new Date();
    // Report 189 is missing from older P_GetReport_XML versions; the catalog is always there.
    const key: FomReportKey = (await fomReportIdFor(config, "organizations")) == null ? "catalog" : "organizations";
    const rows = await fetchFomReport(
      { ...config, timeoutMs: Math.min(config.timeoutMs, key === "catalog" ? 120_000 : 20_000) },
      (await fomReportIdFor(config, key))!,
      config.filialIds[0] ?? "1",
      today,
      today,
    );
    return { ok: true, message: `FOM serveri javob berdi: ${rows.length} ta ${key === "catalog" ? "tovar" : "tashkilot"}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------- SITE.exe push

export async function importSitePush(rows: FomRow[]): Promise<{ products: number; batches: number }> {
  const lookups = await loadLookups();
  const valid = rows.filter((row) => row.I);
  const products = await importCatalog(
    lookups,
    valid
      .filter((row) => row.N)
      .map((row) => ({
        fomId: row.I,
        name: row.N,
        manufacturer: row.R,
        ikpu: row.IK,
        packageCode: row.UP,
        unit: row.UN,
      })),
  );
  const batches = await importStockSnapshot(lookups, [
    valid.map((row) => ({
      branchFomId: row.O?.trim() || "1",
      productFomId: row.I,
      quantity: row.K,
      retailPrice: row.P,
      expiry: null,
    })),
  ]);
  return { products, batches };
}
