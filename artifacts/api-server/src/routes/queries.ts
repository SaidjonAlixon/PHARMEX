import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  branchesTable,
  cashAccountsTable,
  db,
  debtsTable,
  expensesTable,
  inventoryBalancesTable,
  moneyTransactionsTable,
  productsTable,
  saleItemsTable,
  salesTable,
} from "@workspace/db";
import {
  centsMoney,
  dateConditions,
  dateOnly,
  extendedMoney,
  moneyCents,
  sourceCondition,
  toNumber,
  type DataMode,
} from "./financialUtils";

export interface QueryFilters {
  mode: DataMode;
  branchId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  category?: string;
  paymentType?: string;
  limit?: number;
}

export async function loadSaleLines(filters: QueryFilters) {
  const where = and(
    sourceCondition(salesTable.source, filters.mode),
    ne(salesTable.status, "voided"),
    filters.branchId ? eq(salesTable.branchId, filters.branchId) : undefined,
    dateConditions(salesTable.soldAt, filters.dateFrom, filters.dateTo),
    filters.paymentType
      ? eq(salesTable.paymentType, filters.paymentType)
      : undefined,
    filters.search
      ? or(
          ilike(salesTable.receiptNo, `%${filters.search}%`),
          ilike(salesTable.cashier, `%${filters.search}%`),
          ilike(productsTable.name, `%${filters.search}%`),
        )
      : undefined,
  );

  const query = db
    .select({
      id: saleItemsTable.id,
      saleId: salesTable.id,
      date: salesTable.soldAt,
      receiptNo: salesTable.receiptNo,
      branchId: salesTable.branchId,
      branchName: branchesTable.name,
      cashier: salesTable.cashier,
      productId: productsTable.id,
      productName: productsTable.name,
      quantity: saleItemsTable.quantity,
      unitPrice: saleItemsTable.unitPrice,
      discount: saleItemsTable.discount,
      costPrice: saleItemsTable.costPrice,
      paymentType: salesTable.paymentType,
      status: salesTable.status,
      kind: salesTable.kind,
      source: salesTable.source,
    })
    .from(salesTable)
    .innerJoin(saleItemsTable, eq(saleItemsTable.saleId, salesTable.id))
    .innerJoin(productsTable, eq(productsTable.id, saleItemsTable.productId))
    .innerJoin(branchesTable, eq(branchesTable.id, salesTable.branchId))
    .where(where)
    .orderBy(desc(salesTable.soldAt));

  const rows = filters.limit ? await query.limit(filters.limit) : await query;
  return rows.map((row) => {
    // Customer returns are stored with positive quantities and reduce sales.
    const sign = row.kind === "return" ? -1n : 1n;
    const quantity = row.kind === "return" ? `-${row.quantity}` : row.quantity;
    const revenueCents =
      extendedMoney(row.unitPrice, quantity) - sign * moneyCents(row.discount);
    const costCents = row.costPrice
      ? extendedMoney(row.costPrice, quantity)
      : null;
    return {
      id: row.id,
      date: row.date,
      receiptNo: row.receiptNo,
      branchId: row.branchId,
      branchName: row.branchName,
      cashier: row.cashier,
      productId: row.productId,
      productName: row.productName,
      quantity: toNumber(quantity),
      unitPrice: row.unitPrice,
      discount: row.discount,
      costPrice: row.costPrice,
      revenue: centsMoney(revenueCents),
      grossProfit:
        costCents == null ? null : centsMoney(revenueCents - costCents),
      paymentType: row.paymentType,
      status: row.status,
      source: row.source,
      costCents,
      revenueCents,
    };
  });
}

export async function loadExpenses(filters: QueryFilters) {
  const conditions: Array<SQL | undefined> = [
    sourceCondition(expensesTable.source, filters.mode),
    filters.branchId ? eq(expensesTable.branchId, filters.branchId) : undefined,
    dateConditions(expensesTable.date, filters.dateFrom, filters.dateTo),
    filters.category
      ? eq(expensesTable.category, filters.category)
      : undefined,
  ];
  const where = and(...conditions);
  return db
    .select({
      id: expensesTable.id,
      date: expensesTable.date,
      branchId: expensesTable.branchId,
      branchName: branchesTable.name,
      category: expensesTable.category,
      description: expensesTable.description,
      amount: expensesTable.amount,
      source: expensesTable.source,
      status: expensesTable.status,
    })
    .from(expensesTable)
    .innerJoin(branchesTable, eq(branchesTable.id, expensesTable.branchId))
    .where(where)
    .orderBy(desc(expensesTable.date));
}

export async function loadInventory(filters: QueryFilters) {
  const conditions: Array<SQL | undefined> = [
    sourceCondition(inventoryBalancesTable.source, filters.mode),
    sql`not (${inventoryBalancesTable.source} = 'fom' and ${inventoryBalancesTable.quantity} = 0)`,
    filters.branchId
      ? eq(inventoryBalancesTable.branchId, filters.branchId)
      : undefined,
    filters.search
      ? or(
          ilike(productsTable.name, `%${filters.search}%`),
          ilike(productsTable.barcode, `%${filters.search}%`),
          ilike(productsTable.code, `%${filters.search}%`),
          ilike(productsTable.manufacturer, `%${filters.search}%`),
          ilike(productsTable.ikpu, `%${filters.search}%`),
        )
      : undefined,
  ];
  const rows = await db
    .select({
      productId: productsTable.id,
      productName: productsTable.name,
      barcode: productsTable.barcode,
      group: productsTable.groupName,
      manufacturer: productsTable.manufacturer,
      ikpu: productsTable.ikpu,
      branchId: inventoryBalancesTable.branchId,
      branchName: branchesTable.name,
      quantity: inventoryBalancesTable.quantity,
      balanceCost: inventoryBalancesTable.costPrice,
      productCost: productsTable.costPrice,
      retailPrice: productsTable.retailPrice,
      expiryDate: productsTable.expiryDate,
      source: inventoryBalancesTable.source,
    })
    .from(inventoryBalancesTable)
    .innerJoin(productsTable, eq(productsTable.id, inventoryBalancesTable.productId))
    .innerJoin(branchesTable, eq(branchesTable.id, inventoryBalancesTable.branchId))
    .where(and(...conditions));

  return rows.map((row) => {
    const costPrice = row.balanceCost ?? row.productCost;
    const value =
      costPrice == null
        ? null
        : centsMoney(extendedMoney(costPrice, row.quantity));
    return {
      productId: row.productId,
      productName: row.productName,
      barcode: row.barcode,
      group: row.group,
      manufacturer: row.manufacturer,
      ikpu: row.ikpu,
      branchId: row.branchId,
      branchName: row.branchName,
      quantity: toNumber(row.quantity),
      costPrice,
      retailPrice: row.retailPrice,
      value,
      expiryDate: row.expiryDate,
      source: row.source,
    };
  });
}

export type DebtState = "open" | "partial" | "closed" | "overdue" | "cancelled";

export async function loadDebts(
  filters: QueryFilters & {
    kind?: string;
    status?: "open" | "closed" | "overdue" | "all";
    counterpartyId?: number;
    debtId?: number;
    includeCancelled?: boolean;
  },
) {
  const rows = await db
    .select({
      id: debtsTable.id,
      kind: debtsTable.kind,
      counterparty: debtsTable.counterparty,
      counterpartyId: debtsTable.counterpartyId,
      documentNo: debtsTable.documentNo,
      branchId: debtsTable.branchId,
      branchName: branchesTable.name,
      issuedDate: debtsTable.issuedDate,
      dueDate: debtsTable.dueDate,
      initialAmount: debtsTable.initialAmount,
      paidAmount: debtsTable.paidAmount,
      returnedAmount: debtsTable.returnedAmount,
      originType: debtsTable.originType,
      originId: debtsTable.originId,
      status: debtsTable.status,
      note: debtsTable.note,
      source: debtsTable.source,
    })
    .from(debtsTable)
    .innerJoin(branchesTable, eq(branchesTable.id, debtsTable.branchId))
    .where(
      and(
        sourceCondition(debtsTable.source, filters.mode),
        filters.includeCancelled || filters.debtId
          ? undefined
          : ne(debtsTable.status, "cancelled"),
        filters.debtId ? eq(debtsTable.id, filters.debtId) : undefined,
        filters.branchId ? eq(debtsTable.branchId, filters.branchId) : undefined,
        filters.kind ? eq(debtsTable.kind, filters.kind) : undefined,
        filters.counterpartyId
          ? eq(debtsTable.counterpartyId, filters.counterpartyId)
          : undefined,
        filters.search
          ? or(
              ilike(debtsTable.counterparty, `%${filters.search}%`),
              ilike(debtsTable.documentNo, `%${filters.search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(debtsTable.dueDate));
  const today = new Date().toISOString().slice(0, 10);
  const mapped = rows.map((row) => {
    const balanceCents =
      moneyCents(row.initialAmount) -
      moneyCents(row.paidAmount) -
      moneyCents(row.returnedAmount);
    const settled =
      moneyCents(row.paidAmount) + moneyCents(row.returnedAmount) > 0n;
    let state: DebtState;
    if (row.status === "cancelled") state = "cancelled";
    else if (balanceCents <= 0n) state = "closed";
    else if (row.dueDate < today) state = "overdue";
    else if (settled) state = "partial";
    else state = "open";
    const overdueDays =
      state === "overdue"
        ? Math.floor(
            (Date.parse(today) - Date.parse(row.dueDate)) / (24 * 60 * 60 * 1000),
          )
        : 0;
    const { status: _status, ...rest } = row;
    return {
      ...rest,
      balance: centsMoney(balanceCents),
      state,
      overdueDays,
    };
  });
  if (!filters.status || filters.status === "all") return mapped;
  if (filters.status === "open") {
    return mapped.filter((debt) => debt.state !== "closed" && debt.state !== "cancelled");
  }
  if (filters.status === "overdue") {
    return mapped.filter((debt) => debt.state === "overdue");
  }
  return mapped.filter((debt) => debt.state === "closed");
}

export async function loadMoneyTransactions(
  filters: QueryFilters & {
    accountId?: number;
    type?: string;
    direction?: string;
    ids?: number[];
  },
) {
  const rows = await db
    .select({
      id: moneyTransactionsTable.id,
      date: moneyTransactionsTable.date,
      type: moneyTransactionsTable.type,
      category: moneyTransactionsTable.category,
      amount: moneyTransactionsTable.amount,
      direction: moneyTransactionsTable.direction,
      accountId: moneyTransactionsTable.accountId,
      accountName: cashAccountsTable.name,
      accountKind: cashAccountsTable.kind,
      branchId: moneyTransactionsTable.branchId,
      branchName: branchesTable.name,
      counterpartyName: moneyTransactionsTable.counterpartyName,
      transferGroupId: moneyTransactionsTable.transferGroupId,
      debtId: moneyTransactionsTable.debtId,
      saleId: moneyTransactionsTable.saleId,
      purchaseId: moneyTransactionsTable.purchaseId,
      documentNo: moneyTransactionsTable.documentNo,
      note: moneyTransactionsTable.note,
      createdBy: moneyTransactionsTable.createdBy,
      source: moneyTransactionsTable.source,
    })
    .from(moneyTransactionsTable)
    .innerJoin(
      cashAccountsTable,
      eq(cashAccountsTable.id, moneyTransactionsTable.accountId),
    )
    .leftJoin(
      branchesTable,
      eq(branchesTable.id, moneyTransactionsTable.branchId),
    )
    .where(
      and(
        sourceCondition(moneyTransactionsTable.source, filters.mode),
        filters.branchId
          ? eq(moneyTransactionsTable.branchId, filters.branchId)
          : undefined,
        dateConditions(moneyTransactionsTable.date, filters.dateFrom, filters.dateTo),
        filters.accountId
          ? eq(moneyTransactionsTable.accountId, filters.accountId)
          : undefined,
        filters.type ? eq(moneyTransactionsTable.type, filters.type) : undefined,
        filters.direction
          ? eq(moneyTransactionsTable.direction, filters.direction)
          : undefined,
        filters.ids ? inArray(moneyTransactionsTable.id, filters.ids) : undefined,
        filters.search
          ? or(
              ilike(moneyTransactionsTable.note, `%${filters.search}%`),
              ilike(moneyTransactionsTable.documentNo, `%${filters.search}%`),
              ilike(moneyTransactionsTable.counterpartyName, `%${filters.search}%`),
              ilike(moneyTransactionsTable.category, `%${filters.search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(moneyTransactionsTable.date), desc(moneyTransactionsTable.id));
  return rows.map((row) => ({
    ...row,
    branchName: row.branchName ?? "Kompaniya",
  }));
}

export async function loadCashAccounts(filters: QueryFilters) {
  const accounts = await db
    .select({
      id: cashAccountsTable.id,
      name: cashAccountsTable.name,
      kind: cashAccountsTable.kind,
      branchId: cashAccountsTable.branchId,
      branchName: branchesTable.name,
      openingBalance: cashAccountsTable.openingBalance,
      source: cashAccountsTable.source,
    })
    .from(cashAccountsTable)
    .leftJoin(
      branchesTable,
      eq(branchesTable.id, cashAccountsTable.branchId),
    )
    .where(
      and(
        sourceCondition(cashAccountsTable.source, filters.mode),
        filters.branchId
          ? eq(cashAccountsTable.branchId, filters.branchId)
          : undefined,
      ),
    );

  const transactions = await db
    .select({
      accountId: moneyTransactionsTable.accountId,
      amount: moneyTransactionsTable.amount,
      direction: moneyTransactionsTable.direction,
      transferGroupId: moneyTransactionsTable.transferGroupId,
    })
    .from(moneyTransactionsTable)
    .where(sourceCondition(moneyTransactionsTable.source, filters.mode));

  return accounts.map((account) => {
    const accountRows = transactions.filter(
      (transaction) => transaction.accountId === account.id,
    );
    const opening = moneyCents(account.openingBalance);
    const inflow = accountRows
      .filter(
        (transaction) =>
          transaction.direction === "in" && !transaction.transferGroupId,
      )
      .reduce((sum, transaction) => sum + moneyCents(transaction.amount), 0n);
    const outflow = accountRows
      .filter(
        (transaction) =>
          transaction.direction === "out" && !transaction.transferGroupId,
      )
      .reduce((sum, transaction) => sum + moneyCents(transaction.amount), 0n);
    const transfers = accountRows.reduce((sum, transaction) => {
      if (!transaction.transferGroupId) return sum;
      if (transaction.direction === "in") return sum + moneyCents(transaction.amount);
      if (transaction.direction === "out") return sum - moneyCents(transaction.amount);
      return sum;
    }, 0n);
    return {
      id: account.id,
      name: account.name,
      kind: account.kind,
      branchId: account.branchId,
      branchName: account.branchName ?? "Kompaniya",
      openingBalance: centsMoney(opening),
      inflow: centsMoney(inflow),
      outflow: centsMoney(outflow),
      balance: centsMoney(opening + inflow - outflow + transfers),
      source: account.source,
    };
  });
}

export function reportDate(date: Date | string): string {
  return dateOnly(date);
}
