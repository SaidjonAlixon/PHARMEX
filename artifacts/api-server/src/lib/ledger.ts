import { and, eq, inArray, sql } from "drizzle-orm";
import {
  auditLogTable,
  branchesTable,
  cashAccountsTable,
  counterpartiesTable,
  db,
  debtPaymentsTable,
  debtsTable,
  inventoryBalancesTable,
  moneyTransactionsTable,
  productsTable,
} from "@workspace/db";
import {
  centsMoney,
  divideRounded,
  extendedMoney,
  milliQuantity,
  moneyCents,
  quantityMilli,
} from "../routes/financialUtils";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BusinessError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
  ) {
    super(message);
  }
}

export function fail(message: string, status = 422): never {
  throw new BusinessError(message, status);
}

export function actorOf(locals: Record<string, unknown>) {
  return {
    id: String(locals.userId ?? ""),
    name: String(locals.userName ?? locals.userId ?? ""),
  };
}

export async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  entityType: string,
  entityId: number | string,
  summary: string,
) {
  await tx.insert(auditLogTable).values({
    actorId,
    action,
    entityType,
    entityId: String(entityId),
    summary,
  });
}

export async function requireBranch(tx: Tx, branchId: number) {
  const [branch] = await tx
    .select()
    .from(branchesTable)
    .where(eq(branchesTable.id, branchId))
    .limit(1);
  if (!branch) fail("Filial topilmadi.", 404);
  return branch;
}

export async function loadProductsById(tx: Tx, productIds: number[]) {
  const ids = [...new Set(productIds)];
  const rows = ids.length
    ? await tx.select().from(productsTable).where(inArray(productsTable.id, ids))
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    if (!byId.has(id)) fail(`Mahsulot topilmadi (ID ${id}).`, 404);
  }
  return byId;
}

async function lockBalance(tx: Tx, branchId: number, productId: number) {
  const [row] = await tx
    .select()
    .from(inventoryBalancesTable)
    .where(
      and(
        eq(inventoryBalancesTable.branchId, branchId),
        eq(inventoryBalancesTable.productId, productId),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

export async function currentStock(tx: Tx, branchId: number, productId: number) {
  const row = await lockBalance(tx, branchId, productId);
  return {
    quantityMilli: row ? quantityMilli(row.quantity) : 0n,
    costPrice: row?.costPrice ?? null,
  };
}

/** Removes stock and returns the average unit cost it left at. */
export async function stockOut(
  tx: Tx,
  input: {
    branchId: number;
    productId: number;
    productName: string;
    quantityMilli: bigint;
    fallbackCost?: string | null;
  },
): Promise<string | null> {
  const row = await lockBalance(tx, input.branchId, input.productId);
  const available = row ? quantityMilli(row.quantity) : 0n;
  if (available < input.quantityMilli) {
    fail(
      `"${input.productName}" qoldig‘i yetarli emas: mavjud ${milliQuantity(available)}, kerak ${milliQuantity(input.quantityMilli)}.`,
    );
  }
  await tx
    .update(inventoryBalancesTable)
    .set({ quantity: milliQuantity(available - input.quantityMilli) })
    .where(eq(inventoryBalancesTable.id, row!.id));
  return row!.costPrice ?? input.fallbackCost ?? null;
}

/** Adds stock, re-averaging the unit cost of what is already on hand. */
export async function stockIn(
  tx: Tx,
  input: {
    branchId: number;
    productId: number;
    quantityMilli: bigint;
    unitCost: string | null;
  },
) {
  const row = await lockBalance(tx, input.branchId, input.productId);
  if (!row) {
    await tx.insert(inventoryBalancesTable).values({
      branchId: input.branchId,
      productId: input.productId,
      quantity: milliQuantity(input.quantityMilli),
      costPrice: input.unitCost,
      source: "manual",
    });
    return;
  }
  const onHand = quantityMilli(row.quantity);
  const total = onHand + input.quantityMilli;
  let costPrice = row.costPrice;
  if (input.unitCost != null) {
    if (row.costPrice == null || onHand <= 0n || total <= 0n) {
      costPrice = input.unitCost;
    } else {
      const value =
        extendedMoney(row.costPrice, milliQuantity(onHand)) +
        extendedMoney(input.unitCost, milliQuantity(input.quantityMilli));
      costPrice = centsMoney(divideRounded(value * 1000n, total));
    }
  }
  await tx
    .update(inventoryBalancesTable)
    .set({ quantity: milliQuantity(total), costPrice })
    .where(eq(inventoryBalancesTable.id, row.id));
}

export async function lockAccount(tx: Tx, accountId: number) {
  const [account] = await tx
    .select()
    .from(cashAccountsTable)
    .where(eq(cashAccountsTable.id, accountId))
    .for("update")
    .limit(1);
  if (!account) fail("Kassa yoki bank hisobi topilmadi.", 404);
  return account;
}

export async function accountBalanceCents(tx: Tx, accountId: number, openingBalance: string) {
  const [row] = await tx
    .select({
      net: sql<string>`coalesce(sum(case when ${moneyTransactionsTable.direction} = 'in' then ${moneyTransactionsTable.amount} when ${moneyTransactionsTable.direction} = 'out' then -${moneyTransactionsTable.amount} else 0 end), 0)::text`,
    })
    .from(moneyTransactionsTable)
    .where(eq(moneyTransactionsTable.accountId, accountId));
  return moneyCents(openingBalance) + moneyCents(row?.net ?? "0");
}

export async function defaultAccount(
  tx: Tx,
  branchId: number,
  kind: "cash" | "bank",
) {
  const [branchAccount] = await tx
    .select()
    .from(cashAccountsTable)
    .where(and(eq(cashAccountsTable.branchId, branchId), eq(cashAccountsTable.kind, kind)))
    .limit(1);
  if (branchAccount) return branchAccount;
  if (kind === "bank") {
    const [companyBank] = await tx
      .select()
      .from(cashAccountsTable)
      .where(and(sql`${cashAccountsTable.branchId} is null`, eq(cashAccountsTable.kind, "bank")))
      .limit(1);
    if (companyBank) return companyBank;
  }
  return null;
}

export interface MoneyPosting {
  accountId: number;
  direction: "in" | "out";
  amountCents: bigint;
  date: Date;
  type: string;
  category?: string;
  branchId?: number | null;
  counterpartyName?: string;
  debtId?: number | null;
  saleId?: number | null;
  purchaseId?: number | null;
  transferGroupId?: string | null;
  documentNo?: string;
  note?: string;
  createdBy: string;
}

export async function postMoney(tx: Tx, posting: MoneyPosting) {
  if (posting.amountCents <= 0n) fail("Summa noldan katta bo‘lishi kerak.", 400);
  const account = await lockAccount(tx, posting.accountId);
  if (posting.direction === "out" && account.kind === "cash") {
    const balance = await accountBalanceCents(tx, account.id, account.openingBalance);
    if (balance < posting.amountCents) {
      fail(
        `"${account.name}" kassasida mablag‘ yetarli emas: qoldiq ${centsMoney(balance)}, kerak ${centsMoney(posting.amountCents)} so‘m.`,
      );
    }
  }
  const [row] = await tx
    .insert(moneyTransactionsTable)
    .values({
      date: posting.date,
      type: posting.type,
      category: posting.category ?? "",
      amount: centsMoney(posting.amountCents),
      direction: posting.direction,
      accountId: account.id,
      branchId: posting.branchId ?? account.branchId,
      transferGroupId: posting.transferGroupId ?? null,
      counterpartyName: posting.counterpartyName ?? "",
      debtId: posting.debtId ?? null,
      saleId: posting.saleId ?? null,
      purchaseId: posting.purchaseId ?? null,
      documentNo: posting.documentNo ?? "",
      note: posting.note ?? "",
      createdBy: posting.createdBy,
      source: "manual",
    })
    .returning();
  return row;
}

export function debtBalanceCents(debt: {
  initialAmount: string;
  paidAmount: string;
  returnedAmount: string;
}) {
  return (
    moneyCents(debt.initialAmount) -
    moneyCents(debt.paidAmount) -
    moneyCents(debt.returnedAmount)
  );
}

export async function lockDebt(tx: Tx, debtId: number) {
  const [debt] = await tx
    .select()
    .from(debtsTable)
    .where(eq(debtsTable.id, debtId))
    .for("update")
    .limit(1);
  if (!debt) fail("Qarz hujjati topilmadi.", 404);
  if (debt.status === "cancelled") fail("Bu qarz bekor qilingan.");
  return debt;
}

/**
 * Applies a payment, return or write-off to a debt. Payments move money in
 * the debt's direction: we pay suppliers, customers pay us.
 */
export async function applyDebtOperation(
  tx: Tx,
  input: {
    debtId: number;
    kind: "payment" | "return" | "writeoff";
    amountCents: bigint;
    date: Date;
    accountId?: number | null;
    note?: string;
    createdBy: string;
    stockDocumentId?: number | null;
    moneyTransactionId?: number | null;
    purchaseId?: number | null;
    saleId?: number | null;
  },
) {
  if (input.amountCents <= 0n) fail("Summa noldan katta bo‘lishi kerak.", 400);
  const debt = await lockDebt(tx, input.debtId);
  const balance = debtBalanceCents(debt);
  if (input.amountCents > balance) {
    fail(
      `Summa qarz qoldig‘idan oshib ketdi: qoldiq ${centsMoney(balance)} so‘m.`,
    );
  }

  let moneyTransactionId = input.moneyTransactionId ?? null;
  let accountId = input.accountId ?? null;
  if (input.kind === "payment" && moneyTransactionId == null) {
    if (!accountId) fail("To‘lov uchun kassa yoki bank hisobini tanlang.", 400);
    const money = await postMoney(tx, {
      accountId,
      direction: debt.kind === "payable" ? "out" : "in",
      amountCents: input.amountCents,
      date: input.date,
      type: debt.kind === "payable" ? "supplier_payment" : "customer_payment",
      branchId: debt.branchId,
      counterpartyName: debt.counterparty,
      debtId: debt.id,
      purchaseId: input.purchaseId ?? null,
      saleId: input.saleId ?? null,
      documentNo: debt.documentNo,
      note: input.note ?? "",
      createdBy: input.createdBy,
    });
    moneyTransactionId = money.id;
    accountId = money.accountId;
  }

  const [operation] = await tx
    .insert(debtPaymentsTable)
    .values({
      debtId: debt.id,
      kind: input.kind,
      amount: centsMoney(input.amountCents),
      date: input.date,
      accountId,
      moneyTransactionId,
      stockDocumentId: input.stockDocumentId ?? null,
      note: input.note ?? "",
      createdBy: input.createdBy,
      source: "manual",
    })
    .returning();

  const update =
    input.kind === "payment"
      ? { paidAmount: centsMoney(moneyCents(debt.paidAmount) + input.amountCents) }
      : {
          returnedAmount: centsMoney(
            moneyCents(debt.returnedAmount) + input.amountCents,
          ),
        };
  await tx.update(debtsTable).set(update).where(eq(debtsTable.id, debt.id));
  return { debt, operation };
}

export async function findOrCreateCounterparty(
  tx: Tx,
  input: { id?: number | null; name: string; kind: "supplier" | "customer" },
) {
  if (input.id) {
    const [existing] = await tx
      .select()
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.id, input.id))
      .limit(1);
    if (!existing) fail("Hamkor topilmadi.", 404);
    return existing;
  }
  const name = input.name.trim();
  if (name.length < 2) fail("Hamkor nomini kiriting.", 400);
  const [existing] = await tx
    .select()
    .from(counterpartiesTable)
    .where(
      and(
        eq(counterpartiesTable.kind, input.kind),
        sql`lower(${counterpartiesTable.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(counterpartiesTable)
    .values({ name, kind: input.kind })
    .returning();
  return created;
}

export function dateOnlyString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function documentNumber(prefix: string, id: number) {
  return `${prefix}-${String(id).padStart(6, "0")}`;
}
