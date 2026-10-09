import { and, asc, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  branchesTable,
  db,
  debtsTable,
  inventoryMovementsTable,
  productsTable,
  purchaseItemsTable,
  purchasesTable,
} from "@workspace/db";
import {
  CreatePurchaseBody,
  CreatePurchaseResponse,
  GetPurchaseQueryParams,
  GetPurchaseResponse,
  ListPurchasesQueryParams,
  ListPurchasesResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";
import {
  actorOf,
  applyDebtOperation,
  audit,
  dateOnlyString,
  documentNumber,
  fail,
  findOrCreateCounterparty,
  loadProductsById,
  requireBranch,
  stockIn,
} from "../lib/ledger";
import {
  centsMoney,
  dateConditions,
  divideRounded,
  extendedMoney,
  includedVatCents,
  milliQuantity,
  moneyCents,
  quantityMilli,
  toNumber,
} from "./financialUtils";
import { loadDebtDetail } from "./debts";
import { loadStockDocuments } from "./stock";

const router: IRouter = Router();

type PaymentStatus = "paid" | "partial" | "unpaid" | "overdue";

interface PurchaseFilters {
  ids?: number[];
  dateFrom?: Date;
  dateTo?: Date;
  branchId?: number;
  search?: string;
  paymentStatus?: PaymentStatus;
}

export async function loadPurchases(filters: PurchaseFilters) {
  const pattern = filters.search ? `%${filters.search}%` : null;
  const conditions: Array<SQL | undefined> = [
    filters.ids ? inArray(purchasesTable.id, filters.ids) : undefined,
    dateConditions(purchasesTable.receivedAt, filters.dateFrom, filters.dateTo),
    filters.branchId ? eq(purchasesTable.branchId, filters.branchId) : undefined,
    pattern
      ? or(
          ilike(purchasesTable.supplierName, pattern),
          ilike(purchasesTable.documentNo, pattern),
          ilike(purchasesTable.invoiceNo, pattern),
          ilike(purchasesTable.eInvoiceId, pattern),
        )
      : undefined,
  ];
  const rows = await db
    .select({ purchase: purchasesTable, branchName: branchesTable.name, debt: debtsTable })
    .from(purchasesTable)
    .innerJoin(branchesTable, eq(branchesTable.id, purchasesTable.branchId))
    .leftJoin(debtsTable, eq(debtsTable.id, purchasesTable.debtId))
    .where(and(...conditions))
    .orderBy(desc(purchasesTable.receivedAt), desc(purchasesTable.id))
    .limit(500);
  if (rows.length === 0) return [];
  const counts = await db
    .select({ purchaseId: purchaseItemsTable.purchaseId })
    .from(purchaseItemsTable)
    .where(inArray(purchaseItemsTable.purchaseId, rows.map((row) => row.purchase.id)));
  const today = new Date().toISOString().slice(0, 10);

  const mapped = rows.map(({ purchase, branchName, debt }) => {
    const total = moneyCents(purchase.totalAmount);
    const paid = debt ? moneyCents(debt.paidAmount) : total;
    const returned = debt ? moneyCents(debt.returnedAmount) : 0n;
    const balance = total - paid - returned;
    const dueDate = debt?.dueDate ?? purchase.dueDate;
    let paymentStatus: PaymentStatus;
    if (balance <= 0n) paymentStatus = "paid";
    else if (dueDate && dueDate < today) paymentStatus = "overdue";
    else if (paid + returned > 0n) paymentStatus = "partial";
    else paymentStatus = "unpaid";
    return {
      id: purchase.id,
      branchId: purchase.branchId,
      branchName,
      counterpartyId: purchase.counterpartyId,
      supplierName: purchase.supplierName,
      documentNo: purchase.documentNo,
      invoiceNo: purchase.invoiceNo,
      eInvoiceId: purchase.eInvoiceId,
      invoiceDate: purchase.invoiceDate,
      receivedAt: purchase.receivedAt,
      itemsCount: counts.filter((row) => row.purchaseId === purchase.id).length,
      itemsTotal: purchase.itemsTotal,
      discount: purchase.discount,
      extraCosts: purchase.extraCosts,
      extraCostsNote: purchase.extraCostsNote,
      vatAmount: purchase.vatAmount,
      totalAmount: purchase.totalAmount,
      paidAmount: centsMoney(paid),
      returnedAmount: centsMoney(returned),
      balance: centsMoney(balance),
      dueDate,
      paymentStatus,
      debtId: purchase.debtId,
      note: purchase.note,
      createdBy: purchase.createdBy,
    };
  });
  return filters.paymentStatus
    ? mapped.filter((row) => row.paymentStatus === filters.paymentStatus)
    : mapped;
}

async function loadPurchaseDetail(purchaseId: number) {
  const [purchase] = await loadPurchases({ ids: [purchaseId] });
  if (!purchase) return null;
  const items = await db
    .select({ item: purchaseItemsTable, product: productsTable })
    .from(purchaseItemsTable)
    .innerJoin(productsTable, eq(productsTable.id, purchaseItemsTable.productId))
    .where(eq(purchaseItemsTable.purchaseId, purchaseId))
    .orderBy(asc(purchaseItemsTable.id));
  const debt = purchase.debtId ? await loadDebtDetail(purchase.debtId) : null;
  const returns = await loadStockDocuments({ purchaseId });
  return {
    purchase,
    lines: items.map(({ item, product }) => ({
      id: item.id,
      productId: product.id,
      productName: product.name,
      productCode: product.code ?? product.barcode,
      unit: product.unit,
      quantity: toNumber(item.quantity),
      unitCost: item.unitCost,
      discount: item.discount,
      total: centsMoney(extendedMoney(item.unitCost, item.quantity) - moneyCents(item.discount)),
      vatRate: toNumber(item.vatRate),
      landedUnitCost: item.landedUnitCost,
      expiryDate: item.expiryDate,
    })),
    operations: debt?.operations ?? [],
    returns,
  };
}

router.get("/purchases", async (req, res): Promise<void> => {
  const parsed = ListPurchasesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await loadPurchases({
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    branchId: parsed.data.branchId,
    search: parsed.data.search?.trim() || undefined,
    paymentStatus: parsed.data.paymentStatus,
  });
  res.json(ListPurchasesResponse.parse(rows));
});

router.get("/purchase-detail", async (req, res): Promise<void> => {
  const parsed = GetPurchaseQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const detail = await loadPurchaseDetail(parsed.data.purchaseId);
  if (!detail) {
    res.status(404).json({ error: "Kirim hujjati topilmadi." });
    return;
  }
  res.json(GetPurchaseResponse.parse(detail));
});

router.post(
  "/purchases",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    const parsed = CreatePurchaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    const actor = actorOf(res.locals);
    const purchaseId = await db.transaction(async (tx) => {
      const branch = await requireBranch(tx, input.branchId);
      const products = await loadProductsById(tx, input.items.map((item) => item.productId));
      const supplier = await findOrCreateCounterparty(tx, {
        id: input.counterpartyId,
        name: input.supplierName,
        kind: "supplier",
      });

      const lines = input.items.map((item) => {
        const product = products.get(item.productId)!;
        const qty = quantityMilli(item.quantity);
        if (qty <= 0n) fail(`"${product.name}" miqdori noldan katta bo‘lishi kerak.`, 400);
        const gross = extendedMoney(item.unitCost, milliQuantity(qty));
        const discount = moneyCents(item.discount);
        if (discount > gross) fail(`"${product.name}" chegirmasi summasidan katta.`, 400);
        const vatRate = String(item.vatRate ?? toNumber(product.vatRate));
        return { item, product, qty, net: gross - discount, vatRate };
      });
      const itemsTotal = lines.reduce((sum, line) => sum + line.net, 0n);
      const discount = moneyCents(input.discount);
      const extraCosts = moneyCents(input.extraCosts);
      if (discount > itemsTotal) fail("Hujjat chegirmasi tovarlar summasidan katta.", 400);
      const totalAmount = itemsTotal - discount + extraCosts;
      const paidAmount = moneyCents(input.paidAmount);
      if (paidAmount > totalAmount) fail("To‘langan summa hujjat summasidan katta.", 400);
      if (paidAmount > 0n && !input.paymentAccountId) {
        fail("To‘lov qaysi kassa yoki bank hisobidan qilinganini tanlang.", 400);
      }
      const receivedDate = dateOnlyString(input.receivedAt)!;
      const dueDate = dateOnlyString(input.dueDate) ?? receivedDate;
      if (dueDate < receivedDate) fail("To‘lov muddati kirim sanasidan oldin bo‘lishi mumkin emas.", 400);

      // Spread the document discount and extra costs over lines by value.
      const adjustment = extraCosts - discount;
      let allocated = 0n;
      const landed = lines.map((line, index) => {
        const share =
          index === lines.length - 1
            ? adjustment - allocated
            : divideRounded(adjustment * line.net, itemsTotal || 1n);
        allocated += share;
        const lineLanded = line.net + share;
        return {
          ...line,
          landedUnitCost: centsMoney(divideRounded(lineLanded * 1000n, line.qty)),
        };
      });
      const vatAmount = lines.reduce(
        (sum, line) => sum + includedVatCents(line.net, line.vatRate),
        0n,
      );

      const [purchase] = await tx
        .insert(purchasesTable)
        .values({
          branchId: branch.id,
          counterpartyId: supplier.id,
          supplierName: supplier.name,
          documentNo: input.documentNo?.trim() ?? "",
          invoiceNo: input.invoiceNo?.trim() ?? "",
          eInvoiceId: input.eInvoiceId?.trim() ?? "",
          invoiceDate: dateOnlyString(input.invoiceDate),
          receivedAt: input.receivedAt,
          itemsTotal: centsMoney(itemsTotal),
          discount: centsMoney(discount),
          extraCosts: centsMoney(extraCosts),
          extraCostsNote: input.extraCostsNote?.trim() ?? "",
          vatAmount: centsMoney(vatAmount),
          totalAmount: centsMoney(totalAmount),
          dueDate,
          note: input.note?.trim() ?? "",
          createdBy: actor.name,
        })
        .returning();
      const documentNo = purchase.documentNo || documentNumber("KRM", purchase.id);
      if (!purchase.documentNo) {
        await tx.update(purchasesTable).set({ documentNo }).where(eq(purchasesTable.id, purchase.id));
      }

      for (const line of landed) {
        const quantity = milliQuantity(line.qty);
        await tx.insert(purchaseItemsTable).values({
          purchaseId: purchase.id,
          productId: line.product.id,
          quantity,
          unitCost: line.item.unitCost,
          discount: line.item.discount,
          vatRate: line.vatRate,
          landedUnitCost: line.landedUnitCost,
          expiryDate: dateOnlyString(line.item.expiryDate),
        });
        await stockIn(tx, {
          branchId: branch.id,
          productId: line.product.id,
          quantityMilli: line.qty,
          unitCost: line.landedUnitCost,
        });
        await tx.insert(inventoryMovementsTable).values({
          branchId: branch.id,
          productId: line.product.id,
          movementType: "purchase",
          quantity,
          unitCost: line.landedUnitCost,
          documentNo,
          note: supplier.name,
          occurredAt: input.receivedAt,
          source: "manual",
        });
        await tx
          .update(productsTable)
          .set({
            costPrice: line.landedUnitCost,
            ...(line.item.retailPrice && moneyCents(line.item.retailPrice) > 0n
              ? { retailPrice: line.item.retailPrice }
              : {}),
            ...(line.item.expiryDate ? { expiryDate: dateOnlyString(line.item.expiryDate) } : {}),
          })
          .where(eq(productsTable.id, line.product.id));
      }

      if (totalAmount > 0n) {
        const [debt] = await tx
          .insert(debtsTable)
          .values({
            kind: "payable",
            counterparty: supplier.name,
            counterpartyId: supplier.id,
            originType: "purchase",
            originId: purchase.id,
            documentNo,
            branchId: branch.id,
            issuedDate: receivedDate,
            dueDate,
            initialAmount: centsMoney(totalAmount),
            note: `Kirim ${documentNo}${purchase.invoiceNo ? `, hisob-faktura ${purchase.invoiceNo}` : ""}`,
            source: "manual",
          })
          .returning();
        await tx.update(purchasesTable).set({ debtId: debt.id }).where(eq(purchasesTable.id, purchase.id));
        if (paidAmount > 0n) {
          await applyDebtOperation(tx, {
            debtId: debt.id,
            kind: "payment",
            amountCents: paidAmount,
            date: input.receivedAt,
            accountId: input.paymentAccountId,
            note: `Kirim ${documentNo} bo‘yicha to‘lov`,
            createdBy: actor.name,
            purchaseId: purchase.id,
          });
        }
      }
      await audit(tx, actor.id, "purchase.created", "purchase", purchase.id, `Kirim ${documentNo}: ${supplier.name}, ${centsMoney(totalAmount)} UZS`);
      return purchase.id;
    });
    res.status(201).json(CreatePurchaseResponse.parse(await loadPurchaseDetail(purchaseId)));
  },
);

export default router;
