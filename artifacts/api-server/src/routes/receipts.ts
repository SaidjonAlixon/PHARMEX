import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  branchesTable,
  cashAccountsTable,
  db,
  debtsTable,
  inventoryMovementsTable,
  moneyTransactionsTable,
  productsTable,
  saleItemsTable,
  salePaymentsTable,
  salesTable,
  stockDocumentsTable,
} from "@workspace/db";
import {
  CreateReceiptBody,
  CreateReceiptResponse,
  GetReceiptQueryParams,
  GetReceiptResponse,
  ListReceiptsQueryParams,
  ListReceiptsResponse,
  ReturnReceiptBody,
  ReturnReceiptResponse,
  VoidReceiptBody,
  VoidReceiptResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";
import {
  actorOf,
  addDays,
  applyDebtOperation,
  audit,
  dateOnlyString,
  debtBalanceCents,
  defaultAccount,
  documentNumber,
  fail,
  findOrCreateCounterparty,
  loadProductsById,
  lockAccount,
  lockDebt,
  postMoney,
  requireBranch,
  stockIn,
  stockOut,
  type Tx,
} from "../lib/ledger";
import {
  centsMoney,
  dateConditions,
  divideRounded,
  extendedMoney,
  getDataMode,
  includedVatCents,
  milliQuantity,
  moneyCents,
  quantityMilli,
  sourceCondition,
  toNumber,
  type DataMode,
} from "./financialUtils";

const router: IRouter = Router();
const writers = requireRole("admin", "finance");
const paymentMethods = ["cash", "card", "transfer", "credit", "other"] as const;
type PaymentMethod = (typeof paymentMethods)[number];

function asPaymentMethod(value: string): PaymentMethod {
  return (paymentMethods as readonly string[]).includes(value)
    ? (value as PaymentMethod)
    : "other";
}

function lineFigures(line: {
  quantity: string;
  unitPrice: string;
  discount: string;
  vatRate: string;
  costPrice: string | null;
}) {
  const gross = extendedMoney(line.unitPrice, line.quantity);
  const discount = moneyCents(line.discount);
  const total = gross - discount;
  const cost = line.costPrice == null ? null : extendedMoney(line.costPrice, line.quantity);
  return {
    gross,
    discount,
    total,
    vat: includedVatCents(total, line.vatRate),
    cost,
  };
}

interface ReceiptFilters {
  mode: DataMode;
  ids?: number[];
  originalSaleId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  branchId?: number;
  search?: string;
  kind?: string;
  status?: string;
  paymentMethod?: string;
  limit?: number;
}

async function loadReceipts(filters: ReceiptFilters) {
  const pattern = filters.search ? `%${filters.search}%` : null;
  const sales = await db
    .select({ sale: salesTable, branchName: branchesTable.name })
    .from(salesTable)
    .innerJoin(branchesTable, eq(branchesTable.id, salesTable.branchId))
    .where(
      and(
        sourceCondition(salesTable.source, filters.mode),
        filters.ids ? inArray(salesTable.id, filters.ids) : undefined,
        filters.originalSaleId
          ? eq(salesTable.originalSaleId, filters.originalSaleId)
          : undefined,
        dateConditions(salesTable.soldAt, filters.dateFrom, filters.dateTo),
        filters.branchId ? eq(salesTable.branchId, filters.branchId) : undefined,
        filters.kind ? eq(salesTable.kind, filters.kind) : undefined,
        filters.status ? eq(salesTable.status, filters.status) : undefined,
        filters.paymentMethod
          ? or(
              eq(salesTable.paymentType, filters.paymentMethod),
              sql`exists (select 1 from ${salePaymentsTable} where ${salePaymentsTable.saleId} = ${salesTable.id} and ${salePaymentsTable.method} = ${filters.paymentMethod})`,
            )
          : undefined,
        pattern
          ? or(
              ilike(salesTable.receiptNo, pattern),
              ilike(salesTable.cashier, pattern),
              ilike(salesTable.customerName, pattern),
              sql`exists (select 1 from ${saleItemsTable} inner join ${productsTable} on ${productsTable.id} = ${saleItemsTable.productId} where ${saleItemsTable.saleId} = ${salesTable.id} and (${productsTable.name} ilike ${pattern} or ${productsTable.code} ilike ${pattern}))`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(salesTable.soldAt), desc(salesTable.id))
    .limit(filters.limit ?? 500);
  if (sales.length === 0) return [];

  const ids = sales.map((row) => row.sale.id);
  const [items, payments, returns, originals] = await Promise.all([
    db.select().from(saleItemsTable).where(inArray(saleItemsTable.saleId, ids)),
    db
      .select({ payment: salePaymentsTable, accountName: cashAccountsTable.name })
      .from(salePaymentsTable)
      .leftJoin(cashAccountsTable, eq(cashAccountsTable.id, salePaymentsTable.accountId))
      .where(inArray(salePaymentsTable.saleId, ids)),
    db
      .select({ originalSaleId: salesTable.originalSaleId, item: saleItemsTable })
      .from(salesTable)
      .innerJoin(saleItemsTable, eq(saleItemsTable.saleId, salesTable.id))
      .where(
        and(
          inArray(salesTable.originalSaleId, ids),
          eq(salesTable.kind, "return"),
          eq(salesTable.status, "completed"),
        ),
      ),
    (() => {
      const originalIds = sales
        .map((row) => row.sale.originalSaleId)
        .filter((id): id is number => id != null);
      return originalIds.length
        ? db
            .select({ id: salesTable.id, receiptNo: salesTable.receiptNo })
            .from(salesTable)
            .where(inArray(salesTable.id, originalIds))
        : Promise.resolve([]);
    })(),
  ]);
  const originalNo = new Map(originals.map((row) => [row.id, row.receiptNo]));

  return sales.map(({ sale, branchName }) => {
    let gross = 0n;
    let discount = 0n;
    let total = 0n;
    let vat = 0n;
    let cost: bigint | null = 0n;
    let count = 0;
    for (const item of items) {
      if (item.saleId !== sale.id) continue;
      const figures = lineFigures(item);
      gross += figures.gross;
      discount += figures.discount;
      total += figures.total;
      vat += figures.vat;
      cost = cost == null || figures.cost == null ? null : cost + figures.cost;
      count += 1;
    }
    const returned = returns
      .filter((row) => row.originalSaleId === sale.id)
      .reduce((sum, row) => sum + lineFigures(row.item).total, 0n);
    const salePayments = payments
      .filter((row) => row.payment.saleId === sale.id)
      .map((row) => ({
        method: asPaymentMethod(row.payment.method),
        amount: row.payment.amount,
        accountName: row.accountName ?? (row.payment.method === "credit" ? "Nasiya" : ""),
      }));
    return {
      id: sale.id,
      receiptNo: sale.receiptNo,
      soldAt: sale.soldAt,
      kind: sale.kind === "return" ? ("return" as const) : ("sale" as const),
      status: sale.status === "voided" ? ("voided" as const) : ("completed" as const),
      branchId: sale.branchId,
      branchName,
      cashier: sale.cashier,
      customerName: sale.customerName,
      itemsCount: count,
      grossAmount: centsMoney(gross),
      discount: centsMoney(discount),
      total: centsMoney(total),
      vatAmount: centsMoney(vat),
      cost: cost == null ? null : centsMoney(cost),
      grossProfit: cost == null ? null : centsMoney(total - cost),
      payments: salePayments.length
        ? salePayments
        : [{ method: asPaymentMethod(sale.paymentType), amount: centsMoney(total), accountName: "" }],
      returnedAmount: centsMoney(returned),
      originalSaleId: sale.originalSaleId,
      originalReceiptNo: sale.originalSaleId ? originalNo.get(sale.originalSaleId) ?? null : null,
      voidedAt: sale.voidedAt,
      voidReason: sale.voidReason,
      note: sale.note,
      createdBy: sale.createdBy,
      source: sale.source,
    };
  });
}

async function loadReceiptDetail(receiptId: number) {
  const mode = await getDataMode();
  const [receipt] = await loadReceipts({ mode, ids: [receiptId] });
  if (!receipt) return null;
  const [items, returned, returns] = await Promise.all([
    db
      .select({ item: saleItemsTable, product: productsTable })
      .from(saleItemsTable)
      .innerJoin(productsTable, eq(productsTable.id, saleItemsTable.productId))
      .where(eq(saleItemsTable.saleId, receiptId))
      .orderBy(saleItemsTable.id),
    db
      .select({ originalItemId: saleItemsTable.originalItemId, quantity: saleItemsTable.quantity })
      .from(saleItemsTable)
      .innerJoin(salesTable, eq(salesTable.id, saleItemsTable.saleId))
      .where(
        and(
          eq(salesTable.originalSaleId, receiptId),
          eq(salesTable.kind, "return"),
          eq(salesTable.status, "completed"),
        ),
      ),
    loadReceipts({ mode, originalSaleId: receiptId }),
  ]);
  const lines = items.map(({ item, product }) => {
    const figures = lineFigures(item);
    const returnedMilli = returned
      .filter((row) => row.originalItemId === item.id)
      .reduce((sum, row) => sum + quantityMilli(row.quantity), 0n);
    return {
      id: item.id,
      productId: product.id,
      productName: product.name,
      productCode: product.code ?? product.barcode,
      unit: product.unit,
      quantity: toNumber(item.quantity),
      unitPrice: item.unitPrice,
      discount: item.discount,
      total: centsMoney(figures.total),
      vatRate: toNumber(item.vatRate),
      vatAmount: centsMoney(figures.vat),
      costPrice: item.costPrice,
      cost: figures.cost == null ? null : centsMoney(figures.cost),
      grossProfit: figures.cost == null ? null : centsMoney(figures.total - figures.cost),
      returnedQuantity: toNumber(milliQuantity(returnedMilli)),
    };
  });
  return { receipt, lines, returns };
}

router.get("/receipts", async (req, res): Promise<void> => {
  const parsed = ListReceiptsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await loadReceipts({
    mode: await getDataMode(),
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    branchId: parsed.data.branchId,
    search: parsed.data.search?.trim() || undefined,
    kind: parsed.data.kind,
    status: parsed.data.status,
    paymentMethod: parsed.data.paymentMethod || undefined,
    limit: parsed.data.limit,
  });
  res.json(ListReceiptsResponse.parse(rows));
});

router.get("/receipt-detail", async (req, res): Promise<void> => {
  const parsed = GetReceiptQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const detail = await loadReceiptDetail(parsed.data.receiptId);
  if (!detail) {
    res.status(404).json({ error: "Chek topilmadi." });
    return;
  }
  res.json(GetReceiptResponse.parse(detail));
});

async function paymentAccount(
  tx: Tx,
  branchId: number,
  method: PaymentMethod,
  accountId?: number | null,
) {
  if (accountId) return lockAccount(tx, accountId);
  const kind = method === "card" || method === "transfer" ? "bank" : "cash";
  const account = await defaultAccount(tx, branchId, kind);
  if (!account) {
    fail(
      kind === "cash"
        ? "Filialda naqd kassa ochilmagan. “Pul operatsiyalari” bo‘limida kassa oching."
        : "Karta/o‘tkazma tushumi uchun bank hisobi topilmadi. Avval bank hisobini oching.",
    );
  }
  return account;
}

router.post("/receipts", writers, async (req, res): Promise<void> => {
  const parsed = CreateReceiptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const actor = actorOf(res.locals);
  const saleId = await db.transaction(async (tx) => {
    const branch = await requireBranch(tx, input.branchId);
    const products = await loadProductsById(tx, input.items.map((item) => item.productId));

    const lines = input.items.map((item) => {
      const product = products.get(item.productId)!;
      const qty = quantityMilli(item.quantity);
      if (qty <= 0n) fail(`"${product.name}" miqdori noldan katta bo‘lishi kerak.`, 400);
      const gross = extendedMoney(item.unitPrice, milliQuantity(qty));
      const discount = moneyCents(item.discount);
      if (discount > gross) fail(`"${product.name}" chegirmasi summasidan katta.`, 400);
      return { item, product, qty, total: gross - discount };
    });
    const total = lines.reduce((sum, line) => sum + line.total, 0n);
    const paid = input.payments.reduce((sum, payment) => sum + moneyCents(payment.amount), 0n);
    if (input.payments.some((payment) => moneyCents(payment.amount) <= 0n)) {
      fail("To‘lov summalari noldan katta bo‘lishi kerak.", 400);
    }
    if (paid !== total) {
      fail(
        `To‘lovlar jami (${centsMoney(paid)}) chek summasiga (${centsMoney(total)}) teng bo‘lishi kerak.`,
        400,
      );
    }
    const credit = input.payments.filter((payment) => payment.method === "credit");
    const customerName = input.customerName?.trim() ?? "";
    if (credit.length && !customerName && !input.counterpartyId) {
      fail("Nasiya savdo uchun mijozni kiriting.", 400);
    }

    const manualNo = input.receiptNo?.trim();
    if (manualNo) {
      const [duplicate] = await tx
        .select({ id: salesTable.id })
        .from(salesTable)
        .where(and(eq(salesTable.branchId, branch.id), eq(salesTable.receiptNo, manualNo)))
        .limit(1);
      if (duplicate) fail(`Bu filialda ${manualNo} raqamli chek allaqachon mavjud.`, 409);
    }
    const methods = [...new Set(input.payments.map((payment) => payment.method))];
    const [sale] = await tx
      .insert(salesTable)
      .values({
        branchId: branch.id,
        receiptNo: manualNo || `TMP-${randomUUID()}`,
        soldAt: input.soldAt,
        cashier: input.cashier.trim() || actor.name,
        customerName,
        kind: "sale",
        paymentType: methods.length === 1 ? methods[0] : "mixed",
        status: "completed",
        note: input.note?.trim() ?? "",
        createdBy: actor.name,
        source: "manual",
      })
      .returning();
    const receiptNo = manualNo || documentNumber("CHK", sale.id);
    if (!manualNo) {
      await tx.update(salesTable).set({ receiptNo }).where(eq(salesTable.id, sale.id));
    }

    for (const line of lines) {
      const quantity = milliQuantity(line.qty);
      const costPrice = await stockOut(tx, {
        branchId: branch.id,
        productId: line.product.id,
        productName: line.product.name,
        quantityMilli: line.qty,
        fallbackCost: line.product.costPrice,
      });
      await tx.insert(saleItemsTable).values({
        saleId: sale.id,
        productId: line.product.id,
        quantity,
        unitPrice: line.item.unitPrice,
        discount: line.item.discount,
        vatRate: line.product.vatRate,
        costPrice,
      });
      await tx.insert(inventoryMovementsTable).values({
        branchId: branch.id,
        productId: line.product.id,
        movementType: "sale",
        quantity,
        unitCost: costPrice,
        documentNo: receiptNo,
        occurredAt: input.soldAt,
        source: "manual",
      });
    }

    for (const payment of input.payments) {
      const amountCents = moneyCents(payment.amount);
      if (payment.method === "credit") {
        const counterparty = await findOrCreateCounterparty(tx, {
          id: input.counterpartyId,
          name: customerName,
          kind: "customer",
        });
        const issuedDate = dateOnlyString(input.soldAt)!;
        const dueDate = dateOnlyString(input.dueDate) ?? dateOnlyString(addDays(input.soldAt, 30))!;
        if (dueDate < issuedDate) fail("Nasiya muddati chek sanasidan oldin bo‘lishi mumkin emas.", 400);
        const [debt] = await tx
          .insert(debtsTable)
          .values({
            kind: "receivable",
            counterparty: counterparty.name,
            counterpartyId: counterparty.id,
            originType: "sale",
            originId: sale.id,
            documentNo: receiptNo,
            branchId: branch.id,
            issuedDate,
            dueDate,
            initialAmount: centsMoney(amountCents),
            note: `Nasiya savdo: chek ${receiptNo}`,
            source: "manual",
          })
          .returning();
        if (!customerName) {
          await tx.update(salesTable).set({ customerName: counterparty.name }).where(eq(salesTable.id, sale.id));
        }
        await tx.insert(salePaymentsTable).values({
          saleId: sale.id,
          method: "credit",
          amount: centsMoney(amountCents),
          debtId: debt.id,
        });
        continue;
      }
      const account = await paymentAccount(tx, branch.id, payment.method, payment.accountId);
      await postMoney(tx, {
        accountId: account.id,
        direction: "in",
        amountCents,
        date: input.soldAt,
        type: "sale",
        category: payment.method,
        branchId: branch.id,
        counterpartyName: customerName,
        saleId: sale.id,
        documentNo: receiptNo,
        note: `Chek ${receiptNo}`,
        createdBy: actor.name,
      });
      await tx.insert(salePaymentsTable).values({
        saleId: sale.id,
        method: payment.method,
        amount: centsMoney(amountCents),
        accountId: account.id,
      });
    }
    await audit(tx, actor.id, "sale.created", "sale", sale.id, `Chek ${receiptNo}: ${centsMoney(total)} UZS`);
    return sale.id;
  });
  res.status(201).json(CreateReceiptResponse.parse(await loadReceiptDetail(saleId)));
});

async function lockSale(tx: Tx, saleId: number) {
  const [sale] = await tx
    .select()
    .from(salesTable)
    .where(eq(salesTable.id, saleId))
    .for("update")
    .limit(1);
  if (!sale) fail("Chek topilmadi.", 404);
  if (sale.kind !== "sale") fail("Bu hujjat qaytarish cheki; amal faqat sotuv cheki uchun.");
  if (sale.status === "voided") fail("Chek allaqachon bekor qilingan.");
  return sale;
}

router.post("/receipts/void", writers, async (req, res): Promise<void> => {
  const parsed = VoidReceiptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = actorOf(res.locals);
  const reason = parsed.data.reason.trim();
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, parsed.data.receiptId);
    const [hasReturn] = await tx
      .select({ id: salesTable.id })
      .from(salesTable)
      .where(
        and(
          eq(salesTable.originalSaleId, sale.id),
          eq(salesTable.kind, "return"),
          eq(salesTable.status, "completed"),
        ),
      )
      .limit(1);
    if (hasReturn) {
      fail("Bu chek bo‘yicha qaytarish rasmiylashtirilgan; uni bekor qilib bo‘lmaydi.");
    }
    const now = new Date();
    const items = await tx.select().from(saleItemsTable).where(eq(saleItemsTable.saleId, sale.id));
    for (const item of items) {
      await stockIn(tx, {
        branchId: sale.branchId,
        productId: item.productId,
        quantityMilli: quantityMilli(item.quantity),
        unitCost: item.costPrice,
      });
      await tx.insert(inventoryMovementsTable).values({
        branchId: sale.branchId,
        productId: item.productId,
        movementType: "sale_void",
        quantity: item.quantity,
        unitCost: item.costPrice,
        documentNo: sale.receiptNo,
        note: reason,
        occurredAt: now,
        source: "manual",
      });
    }
    const receipts = await tx
      .select()
      .from(moneyTransactionsTable)
      .where(
        and(
          eq(moneyTransactionsTable.saleId, sale.id),
          eq(moneyTransactionsTable.type, "sale"),
          eq(moneyTransactionsTable.direction, "in"),
        ),
      );
    for (const receipt of receipts) {
      await postMoney(tx, {
        accountId: receipt.accountId,
        direction: "out",
        amountCents: moneyCents(receipt.amount),
        date: now,
        type: "sale_void",
        category: receipt.category,
        branchId: sale.branchId,
        counterpartyName: receipt.counterpartyName,
        saleId: sale.id,
        documentNo: sale.receiptNo,
        note: `Chek bekor qilindi: ${reason}`,
        createdBy: actor.name,
      });
    }
    const debts = await tx
      .select()
      .from(debtsTable)
      .where(and(eq(debtsTable.originType, "sale"), eq(debtsTable.originId, sale.id)));
    for (const row of debts) {
      if (row.status === "cancelled") continue;
      const debt = await lockDebt(tx, row.id);
      if (debtBalanceCents(debt) !== moneyCents(debt.initialAmount)) {
        fail("Nasiya bo‘yicha to‘lov qabul qilingan; chekni bekor qilish o‘rniga qaytarish rasmiylashtiring.");
      }
      await tx
        .update(debtsTable)
        .set({ status: "cancelled", note: `${debt.note} · Chek bekor qilindi: ${reason}`.trim() })
        .where(eq(debtsTable.id, debt.id));
    }
    await tx
      .update(salesTable)
      .set({ status: "voided", voidedAt: now, voidReason: reason })
      .where(eq(salesTable.id, sale.id));
    await audit(tx, actor.id, "sale.voided", "sale", sale.id, `Chek ${sale.receiptNo} bekor qilindi: ${reason}`);
  });
  res.json(VoidReceiptResponse.parse(await loadReceiptDetail(parsed.data.receiptId)));
});

router.post("/receipts/return", writers, async (req, res): Promise<void> => {
  const parsed = ReturnReceiptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const actor = actorOf(res.locals);
  const reason = input.reason.trim();
  const returnId = await db.transaction(async (tx) => {
    const sale = await lockSale(tx, input.receiptId);
    const items = await tx
      .select({ item: saleItemsTable, product: productsTable })
      .from(saleItemsTable)
      .innerJoin(productsTable, eq(productsTable.id, saleItemsTable.productId))
      .where(eq(saleItemsTable.saleId, sale.id));
    const previous = await tx
      .select({ id: salesTable.id, originalItemId: saleItemsTable.originalItemId, quantity: saleItemsTable.quantity })
      .from(salesTable)
      .leftJoin(saleItemsTable, eq(saleItemsTable.saleId, salesTable.id))
      .where(
        and(
          eq(salesTable.originalSaleId, sale.id),
          eq(salesTable.kind, "return"),
        ),
      );

    const lines = input.items.map((requested) => {
      const found = items.find((row) => row.item.id === requested.lineId);
      if (!found) fail("Qaytarilayotgan qator bu chekka tegishli emas.", 400);
      const sold = quantityMilli(found.item.quantity);
      const already = previous
        .filter((row) => row.originalItemId === found.item.id && row.quantity)
        .reduce((sum, row) => sum + quantityMilli(row.quantity!), 0n);
      const qty = quantityMilli(requested.quantity);
      if (qty <= 0n) fail("Qaytarish miqdori noldan katta bo‘lishi kerak.", 400);
      if (qty > sold - already) {
        fail(
          `"${found.product.name}" uchun qaytarish mumkin bo‘lgan miqdor: ${milliQuantity(sold - already)}.`,
        );
      }
      const discount = divideRounded(moneyCents(found.item.discount) * qty, sold);
      const quantity = milliQuantity(qty);
      const total = extendedMoney(found.item.unitPrice, quantity) - discount;
      const cost = found.item.costPrice == null ? null : extendedMoney(found.item.costPrice, quantity);
      return { ...found, qty, quantity, discount, total, cost };
    });
    const refund = lines.reduce((sum, line) => sum + line.total, 0n);
    if (refund <= 0n) fail("Qaytarish summasi noldan katta bo‘lishi kerak.", 400);
    const returnCount = new Set(previous.map((row) => row.id)).size;
    const receiptNo = `${sale.receiptNo}-Q${returnCount + 1}`;

    const [returnSale] = await tx
      .insert(salesTable)
      .values({
        branchId: sale.branchId,
        receiptNo,
        soldAt: input.date,
        cashier: actor.name,
        customerName: sale.customerName,
        kind: "return",
        originalSaleId: sale.id,
        paymentType: input.refundMethod,
        status: "completed",
        note: reason,
        createdBy: actor.name,
        source: "manual",
      })
      .returning();
    const totalCost = lines.reduce((sum, line) => sum + (line.cost ?? 0n), 0n);
    const [document] = await tx
      .insert(stockDocumentsTable)
      .values({
        docType: "customer_return",
        documentNo: receiptNo,
        branchId: sale.branchId,
        counterpartyName: sale.customerName,
        saleId: returnSale.id,
        occurredAt: input.date,
        reason,
        totalCost: centsMoney(totalCost),
        createdBy: actor.name,
      })
      .returning();

    for (const line of lines) {
      await tx.insert(saleItemsTable).values({
        saleId: returnSale.id,
        productId: line.product.id,
        originalItemId: line.item.id,
        quantity: line.quantity,
        unitPrice: line.item.unitPrice,
        discount: centsMoney(line.discount),
        vatRate: line.item.vatRate,
        costPrice: line.item.costPrice,
      });
      await stockIn(tx, {
        branchId: sale.branchId,
        productId: line.product.id,
        quantityMilli: line.qty,
        unitCost: line.item.costPrice,
      });
      await tx.insert(inventoryMovementsTable).values({
        branchId: sale.branchId,
        productId: line.product.id,
        documentId: document.id,
        movementType: "customer_return",
        quantity: line.quantity,
        unitCost: line.item.costPrice,
        documentNo: receiptNo,
        note: reason,
        occurredAt: input.date,
        source: "manual",
      });
    }

    if (input.refundMethod === "credit") {
      const [debt] = await tx
        .select()
        .from(debtsTable)
        .where(
          and(
            eq(debtsTable.originType, "sale"),
            eq(debtsTable.originId, sale.id),
            eq(debtsTable.status, "active"),
          ),
        )
        .limit(1);
      if (!debt) fail("Bu chek nasiyaga sotilmagan; pulni kassa yoki bank orqali qaytaring.");
      await applyDebtOperation(tx, {
        debtId: debt.id,
        kind: "return",
        amountCents: refund,
        date: input.date,
        note: `Mijoz tovarni qaytardi: ${receiptNo}`,
        createdBy: actor.name,
        stockDocumentId: document.id,
      });
      await tx.insert(salePaymentsTable).values({
        saleId: returnSale.id,
        method: "credit",
        amount: centsMoney(refund),
        debtId: debt.id,
      });
    } else {
      const account = await paymentAccount(tx, sale.branchId, input.refundMethod, input.accountId);
      await postMoney(tx, {
        accountId: account.id,
        direction: "out",
        amountCents: refund,
        date: input.date,
        type: "sale_refund",
        category: input.refundMethod,
        branchId: sale.branchId,
        counterpartyName: sale.customerName,
        saleId: returnSale.id,
        documentNo: receiptNo,
        note: `Mijozga qaytarildi: ${reason}`,
        createdBy: actor.name,
      });
      await tx.insert(salePaymentsTable).values({
        saleId: returnSale.id,
        method: input.refundMethod,
        amount: centsMoney(refund),
        accountId: account.id,
      });
    }
    await audit(tx, actor.id, "sale.returned", "sale", returnSale.id, `Qaytarish ${receiptNo}: ${centsMoney(refund)} UZS`);
    return returnSale.id;
  });
  res.status(201).json(ReturnReceiptResponse.parse(await loadReceiptDetail(returnId)));
});

export default router;
