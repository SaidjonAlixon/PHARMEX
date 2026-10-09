import { and, desc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import {
  branchesTable,
  counterpartiesTable,
  db,
  integrationImportsTable,
  inventoryBalancesTable,
  inventoryMovementsTable,
  productsTable,
  purchaseItemsTable,
  purchasesTable,
  saleItemsTable,
  salesTable,
  stockDocumentsTable,
} from "@workspace/db";
import {
  FOM_REPORTS,
  FomError,
  fetchFomReport,
  fomConfig,
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
      })
      .from(counterpartiesTable)
      .where(isNotNull(counterpartiesTable.fomId)),
  ]);
  const lookups: Lookups = {
    branches: new Map(branches.map((row) => [row.fomId!, row.id])),
    products: new Map(products.map((row) => [row.fomId!, { id: row.id, cost: row.cost }])),
    suppliers: new Map(),
    orgNames: new Map(),
  };
  for (const row of counterparties) {
    lookups.orgNames.set(row.fomId!, row.name);
    if (row.kind === "supplier") lookups.suppliers.set(row.fomId!, { id: row.id, name: row.name });
  }
  return lookups;
}

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
        branchRows.map((row) => ({
          name: row.N?.trim() || `Filial ${row.I}`,
          fomId: row.I,
          source: SOURCE,
        })),
      )
      .onConflictDoUpdate({
        target: [branchesTable.source, branchesTable.fomId],
        set: { name: sql`excluded.name` },
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
        .returning({ id: counterpartiesTable.id, fomId: counterpartiesTable.fomId, name: counterpartiesTable.name });
      for (const row of saved) {
        lookups.orgNames.set(row.fomId!, row.name);
        if (kind === "supplier") lookups.suppliers.set(row.fomId!, { id: row.id, name: row.name });
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

  const balances = new Map<string, { branchId: number; productId: number; qty: bigint }>();
  const productInfo = new Map<number, { price: bigint; expiry: string | null }>();
  for (const row of batches) {
    const branchId = lookups.branches.get(row.branchFomId)!;
    const productId = lookups.products.get(row.productFomId)!.id;
    const key = `${branchId}:${productId}`;
    const qty = qtyMilli(row.quantity);
    const entry = balances.get(key) ?? { branchId, productId, qty: 0n };
    entry.qty += qty;
    balances.set(key, entry);
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
          costPrice: costById.get(row.productId) ?? null,
          source: SOURCE,
          updatedAt: stamp,
        })),
      )
      .onConflictDoUpdate({
        target: [inventoryBalancesTable.branchId, inventoryBalancesTable.productId],
        set: { quantity: sql`excluded.quantity`, source: SOURCE, updatedAt: stamp },
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
  await syncBalanceCosts();
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
        const supplier = lookups.suppliers.get(doc.orgId);
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
          receiptNo: `FOM-${doc.number || doc.sourceId.split(":").pop()}`,
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
        const supplier = docType === "supplier_return" ? lookups.suppliers.get(doc.orgId) : undefined;
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

// ---------------------------------------------------------------- orchestration

let running: Promise<SyncDetails> | null = null;

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
  if (running) return { started: false, message: "Sinxronlash allaqachon bajarilmoqda." };
  const [row] = await db
    .insert(integrationImportsTable)
    .values({ integration: "fom", status: "running", message: "Sinxronlash boshlandi…" })
    .returning({ id: integrationImportsTable.id });
  running = runFomSync(config, options, row.id).finally(() => {
    running = null;
  });
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

  const isConnectionError = (error: unknown) =>
    error instanceof FomError && /ulanib boʻlmadi|soniyada kelmadi/.test(error.message);

  type Work = (warn: (message: string) => void) => Promise<{ rows: number; imported: number }>;
  const run = async (key: FomReportKey, work: Work) => {
    if (fatal) {
      details.reports[key] = { rows: 0, imported: 0, error: "Oʻtkazib yuborildi: server bilan aloqa yoʻq.", warning: null };
      return;
    }
    await progress(`${FOM_REPORTS[key].label} yuklanmoqda…`);
    const warnings: string[] = [];
    try {
      const result = await work((message) => warnings.push(message));
      details.reports[key] = { ...result, error: null, warning: warnings.length ? warnings.join("; ").slice(0, 400) : null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      details.reports[key] = { rows: 0, imported: 0, error: message, warning: null };
      if (isConnectionError(error)) fatal = message;
      logger.warn({ err: error, report: key }, "FOM report import failed");
    }
  };

  const fetchReport = (key: FomReportKey, filial: string, rangeFrom = from, rangeTo = to) =>
    fetchFomReport(config, FOM_REPORTS[key].id, filial, rangeFrom, rangeTo);

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

  await run("stock", async (warn) => {
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

  const dated: Array<{ key: FomReportKey; prefix: string; keyOf: (row: FomRow) => string; save: (docs: Doc[]) => Promise<number> }> = [
    { key: "purchases", prefix: "p", keyOf: docKey, save: (docs) => importPurchases(lookups, docs) },
    { key: "supplierReturns", prefix: "sr", keyOf: docKey, save: (docs) => importStockDocuments(lookups, docs, "supplier_return") },
    { key: "writeOffs", prefix: "wo", keyOf: (row) => fomDay(row.D) ?? row.D ?? "", save: (docs) => importStockDocuments(lookups, docs, "write_off") },
    { key: "retailSales", prefix: "rs", keyOf: docKey, save: (docs) => importSales(lookups, docs, "retail") },
    { key: "insuranceSales", prefix: "is", keyOf: docKey, save: (docs) => importSales(lookups, docs, "insurance") },
  ];
  for (const report of dated) {
    await run(report.key, async (warn) => {
      let rows = 0;
      let imported = 0;
      await perFilial(warn, async (filial) => {
        for (const [start, end] of windows(from, to)) {
          const data = await fetchReport(report.key, filial, start, end);
          rows += data.length;
          imported += await report.save(groupDocs(data, report.prefix, filial, report.keyOf));
        }
      });
      return { rows, imported };
    });
  }

  const fetched = Object.entries(details.reports)
    .filter(([key]) => !(skipRefs && REFERENCE_REPORTS.includes(key as FomReportKey)))
    .map(([, outcome]) => outcome);
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
    const rows = await fetchFomReport(
      { ...config, timeoutMs: Math.min(config.timeoutMs, 20_000) },
      FOM_REPORTS.organizations.id,
      config.filialIds[0] ?? "1",
      today,
      today,
    );
    return { ok: true, message: `FOM serveri javob berdi: ${rows.length} ta tashkilot.` };
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
