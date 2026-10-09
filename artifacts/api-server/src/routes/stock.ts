import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router, type IRouter } from "express";
import {
  branchesTable,
  db,
  expensesTable,
  inventoryMovementsTable,
  productsTable,
  purchasesTable,
  stockDocumentsTable,
} from "@workspace/db";
import {
  CreateStockDocumentBody,
  CreateStockDocumentResponse,
  GetStockDocumentQueryParams,
  GetStockDocumentResponse,
  ListStockDocumentsQueryParams,
  ListStockDocumentsResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";
import {
  actorOf,
  applyDebtOperation,
  audit,
  currentStock,
  dateOnlyString,
  debtBalanceCents,
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
} from "../lib/ledger";
import {
  centsMoney,
  dateConditions,
  extendedMoney,
  milliQuantity,
  quantityMilli,
  toNumber,
} from "./financialUtils";

const router: IRouter = Router();

const prefixes = {
  transfer: "OTK",
  write_off: "SPS",
  supplier_return: "QYB",
  customer_return: "QYM",
  inventory_count: "INV",
} as const;

interface StockFilters {
  ids?: number[];
  purchaseId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  branchId?: number;
  docType?: string;
}

export async function loadStockDocuments(filters: StockFilters) {
  const toBranch = alias(branchesTable, "to_branch");
  const conditions: Array<SQL | undefined> = [
    filters.ids ? inArray(stockDocumentsTable.id, filters.ids) : undefined,
    filters.purchaseId ? eq(stockDocumentsTable.purchaseId, filters.purchaseId) : undefined,
    dateConditions(stockDocumentsTable.occurredAt, filters.dateFrom, filters.dateTo),
    filters.docType ? eq(stockDocumentsTable.docType, filters.docType) : undefined,
  ];
  const rows = await db
    .select({
      document: stockDocumentsTable,
      branchName: branchesTable.name,
      branchKind: branchesTable.kind,
      toBranchName: toBranch.name,
      toBranchKind: toBranch.kind,
    })
    .from(stockDocumentsTable)
    .innerJoin(branchesTable, eq(branchesTable.id, stockDocumentsTable.branchId))
    .leftJoin(toBranch, eq(toBranch.id, stockDocumentsTable.toBranchId))
    .where(and(...conditions))
    .orderBy(desc(stockDocumentsTable.occurredAt), desc(stockDocumentsTable.id))
    .limit(500);
  const filtered = filters.branchId
    ? rows.filter(
        (row) =>
          row.document.branchId === filters.branchId ||
          row.document.toBranchId === filters.branchId,
      )
    : rows;
  if (filtered.length === 0) return [];
  const movements = await db
    .select({
      documentId: inventoryMovementsTable.documentId,
      movementType: inventoryMovementsTable.movementType,
      productId: inventoryMovementsTable.productId,
      quantity: inventoryMovementsTable.quantity,
      unitCost: inventoryMovementsTable.unitCost,
    })
    .from(inventoryMovementsTable)
    .where(inArray(inventoryMovementsTable.documentId, filtered.map((row) => row.document.id)));

  return filtered.map(({ document, branchName, branchKind, toBranchName, toBranchKind }) => {
    const own = movements.filter((movement) => movement.documentId === document.id);
    const value = (type: string) =>
      own
        .filter((movement) => movement.movementType === type)
        .reduce((sum, movement) => sum + extendedMoney(movement.unitCost, movement.quantity), 0n);
    return {
      id: document.id,
      docType: document.docType as keyof typeof prefixes,
      documentNo: document.documentNo,
      branchId: document.branchId,
      branchName,
      branchKind,
      toBranchId: document.toBranchId,
      toBranchName,
      toBranchKind,
      counterpartyName: document.counterpartyName,
      purchaseId: document.purchaseId,
      saleId: document.saleId,
      occurredAt: document.occurredAt,
      reason: document.reason,
      note: document.note,
      itemsCount: new Set(own.map((movement) => movement.productId)).size,
      totalCost: document.totalCost,
      surplusValue: centsMoney(value("inventory_surplus")),
      shortageValue: centsMoney(value("inventory_shortage")),
      createdBy: document.createdBy,
    };
  });
}

async function loadStockDocumentDetail(documentId: number) {
  const [document] = await loadStockDocuments({ ids: [documentId] });
  if (!document) return null;
  const rows = await db
    .select({ movement: inventoryMovementsTable, product: productsTable })
    .from(inventoryMovementsTable)
    .innerJoin(productsTable, eq(productsTable.id, inventoryMovementsTable.productId))
    .where(eq(inventoryMovementsTable.documentId, documentId))
    .orderBy(asc(inventoryMovementsTable.id));
  // Transfers are stored as a pair of movements; show the outgoing side.
  const lines = rows
    .filter(({ movement }) => movement.movementType !== "transfer_in")
    .map(({ movement, product }) => ({
      id: movement.id,
      productId: product.id,
      productName: product.name,
      productCode: product.code ?? product.barcode,
      unit: product.unit,
      movementType: movement.movementType,
      quantity: toNumber(movement.quantity),
      expectedQuantity: movement.expectedQuantity == null ? null : toNumber(movement.expectedQuantity),
      countedQuantity: movement.countedQuantity == null ? null : toNumber(movement.countedQuantity),
      unitCost: movement.unitCost,
      total: movement.unitCost == null ? null : centsMoney(extendedMoney(movement.unitCost, movement.quantity)),
    }));
  return { document, lines };
}

router.get("/stock-documents", async (req, res): Promise<void> => {
  const parsed = ListStockDocumentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await loadStockDocuments({
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    branchId: parsed.data.branchId,
    docType: parsed.data.docType,
  });
  res.json(ListStockDocumentsResponse.parse(rows));
});

router.get("/stock-document-detail", async (req, res): Promise<void> => {
  const parsed = GetStockDocumentQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const detail = await loadStockDocumentDetail(parsed.data.documentId);
  if (!detail) {
    res.status(404).json({ error: "Hujjat topilmadi." });
    return;
  }
  res.json(GetStockDocumentResponse.parse(detail));
});

router.post(
  "/stock-documents",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    const parsed = CreateStockDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    const actor = actorOf(res.locals);
    const reason = input.reason?.trim() ?? "";
    const productIds = input.items.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      res.status(400).json({ error: "Bir mahsulot hujjatda faqat bir marta bo‘lishi kerak." });
      return;
    }

    const documentId = await db.transaction(async (tx) => {
      const branch = await requireBranch(tx, input.branchId);
      const products = await loadProductsById(tx, productIds);
      let counterpartyName = input.counterpartyName?.trim() ?? "";
      let counterpartyId = input.counterpartyId ?? null;
      let toBranchId: number | null = null;
      let purchase: typeof purchasesTable.$inferSelect | undefined;

      if (input.docType === "transfer") {
        if (!input.toBranchId) fail("Qabul qiluvchi filial yoki omborni tanlang.", 400);
        if (input.toBranchId === branch.id) fail("Jo‘natuvchi va qabul qiluvchi bir xil bo‘lishi mumkin emas.", 400);
        toBranchId = (await requireBranch(tx, input.toBranchId)).id;
      }
      if (input.docType === "write_off" && !reason) {
        fail("Hisobdan chiqarish sababini kiriting.", 400);
      }
      if (input.docType === "supplier_return") {
        if (input.purchaseId) {
          [purchase] = await tx
            .select()
            .from(purchasesTable)
            .where(eq(purchasesTable.id, input.purchaseId))
            .limit(1);
          if (!purchase) fail("Kirim hujjati topilmadi.", 404);
          if (purchase.branchId !== branch.id) fail("Kirim hujjati boshqa filialga tegishli.", 400);
          counterpartyId = purchase.counterpartyId;
          counterpartyName = purchase.supplierName;
        }
        const supplier = await findOrCreateCounterparty(tx, {
          id: counterpartyId,
          name: counterpartyName,
          kind: "supplier",
        });
        counterpartyId = supplier.id;
        counterpartyName = supplier.name;
      }
      for (const item of input.items) {
        if (input.docType !== "inventory_count" && quantityMilli(item.quantity) <= 0n) {
          fail(`"${products.get(item.productId)!.name}" miqdori noldan katta bo‘lishi kerak.`, 400);
        }
      }

      const [document] = await tx
        .insert(stockDocumentsTable)
        .values({
          docType: input.docType,
          documentNo: input.documentNo?.trim() ?? "",
          branchId: branch.id,
          toBranchId,
          counterpartyId,
          counterpartyName,
          purchaseId: purchase?.id ?? null,
          occurredAt: input.occurredAt,
          reason,
          note: input.note?.trim() ?? "",
          createdBy: actor.name,
        })
        .returning();
      const documentNo = document.documentNo || documentNumber(prefixes[input.docType], document.id);

      let totalCost = 0n;
      let shortage = 0n;
      const movement = (values: {
        branchId: number;
        toBranchId?: number | null;
        productId: number;
        movementType: string;
        quantity: bigint;
        unitCost: string | null;
        expected?: bigint;
        counted?: bigint;
      }) =>
        tx.insert(inventoryMovementsTable).values({
          branchId: values.branchId,
          toBranchId: values.toBranchId ?? null,
          productId: values.productId,
          documentId: document.id,
          movementType: values.movementType,
          quantity: milliQuantity(values.quantity),
          expectedQuantity: values.expected == null ? null : milliQuantity(values.expected),
          countedQuantity: values.counted == null ? null : milliQuantity(values.counted),
          unitCost: values.unitCost,
          documentNo,
          note: reason,
          occurredAt: input.occurredAt,
          source: "manual",
        });

      for (const item of input.items) {
        const product = products.get(item.productId)!;
        const qty = quantityMilli(item.quantity);

        if (input.docType === "inventory_count") {
          const stock = await currentStock(tx, branch.id, product.id);
          const diff = qty - stock.quantityMilli;
          const unitCost = stock.costPrice ?? product.costPrice;
          if (diff > 0n) {
            await stockIn(tx, { branchId: branch.id, productId: product.id, quantityMilli: diff, unitCost });
          } else if (diff < 0n) {
            await stockOut(tx, {
              branchId: branch.id,
              productId: product.id,
              productName: product.name,
              quantityMilli: -diff,
            });
            if (unitCost) shortage += extendedMoney(unitCost, milliQuantity(-diff));
          }
          await movement({
            branchId: branch.id,
            productId: product.id,
            movementType: diff > 0n ? "inventory_surplus" : diff < 0n ? "inventory_shortage" : "inventory_match",
            quantity: diff < 0n ? -diff : diff,
            unitCost,
            expected: stock.quantityMilli,
            counted: qty,
          });
          continue;
        }

        const unitCost = await stockOut(tx, {
          branchId: branch.id,
          productId: product.id,
          productName: product.name,
          quantityMilli: qty,
          fallbackCost: product.costPrice,
        });
        const lineCost =
          input.docType === "supplier_return" && item.unitCost
            ? item.unitCost
            : unitCost;
        if (lineCost) totalCost += extendedMoney(lineCost, milliQuantity(qty));

        if (input.docType === "transfer") {
          await stockIn(tx, { branchId: toBranchId!, productId: product.id, quantityMilli: qty, unitCost });
          await movement({ branchId: branch.id, toBranchId, productId: product.id, movementType: "transfer_out", quantity: qty, unitCost });
          await movement({ branchId: toBranchId!, toBranchId: branch.id, productId: product.id, movementType: "transfer_in", quantity: qty, unitCost });
        } else {
          await movement({
            branchId: branch.id,
            productId: product.id,
            movementType: input.docType,
            quantity: qty,
            unitCost: lineCost,
          });
        }
      }

      await tx
        .update(stockDocumentsTable)
        .set({ documentNo, totalCost: centsMoney(input.docType === "inventory_count" ? shortage : totalCost) })
        .where(eq(stockDocumentsTable.id, document.id));

      const lossCategory =
        input.docType === "write_off"
          ? "Tovar hisobdan chiqarish"
          : input.docType === "inventory_count"
            ? "Inventarizatsiya kamomadi"
            : null;
      const loss = input.docType === "write_off" ? totalCost : shortage;
      if (lossCategory && loss > 0n) {
        await tx.insert(expensesTable).values({
          date: dateOnlyString(input.occurredAt)!,
          branchId: branch.id,
          category: lossCategory,
          description: `${documentNo}${reason ? `: ${reason}` : ""}`,
          amount: centsMoney(loss),
          source: "manual",
          sourceId: `stock-document:${document.id}`,
          status: "confirmed",
        });
      }

      if (input.docType === "supplier_return" && totalCost > 0n) {
        const settlement = input.settlement ?? (purchase?.debtId ? "debt" : "none");
        if (settlement === "debt") {
          if (!purchase?.debtId) fail("Qarzdan ayirish uchun kirim hujjatini tanlang.", 400);
          const debt = await lockDebt(tx, purchase.debtId);
          const amount = totalCost < debtBalanceCents(debt) ? totalCost : debtBalanceCents(debt);
          if (amount <= 0n) fail("Bu kirim bo‘yicha qarz qolmagan; pulni qaytarib olish usulini tanlang.");
          await applyDebtOperation(tx, {
            debtId: debt.id,
            kind: "return",
            amountCents: amount,
            date: input.occurredAt,
            note: `Yetkazib beruvchiga qaytarish ${documentNo}`,
            createdBy: actor.name,
            stockDocumentId: document.id,
          });
        } else if (settlement === "money") {
          if (!input.accountId) fail("Pul qaytariladigan kassa yoki bank hisobini tanlang.", 400);
          const account = await lockAccount(tx, input.accountId);
          await postMoney(tx, {
            accountId: account.id,
            direction: "in",
            amountCents: totalCost,
            date: input.occurredAt,
            type: "supplier_refund",
            branchId: branch.id,
            counterpartyName,
            purchaseId: purchase?.id ?? null,
            documentNo,
            note: `Yetkazib beruvchi pulni qaytardi: ${reason}`,
            createdBy: actor.name,
          });
        }
      }

      await audit(tx, actor.id, `stock.${input.docType}`, "stock_document", document.id, `${documentNo}: ${branch.name}`);
      return document.id;
    });
    res.status(201).json(CreateStockDocumentResponse.parse(await loadStockDocumentDetail(documentId)));
  },
);

export default router;
