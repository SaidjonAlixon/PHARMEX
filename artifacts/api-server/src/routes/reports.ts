import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  branchesTable,
  db,
} from "@workspace/db";
import {
  GetReportQueryParams,
  GetReportResponse,
} from "@workspace/api-zod";
import { getDataMode, moneyCents, centsMoney, sourceCondition } from "./financialUtils";
import {
  loadDebts,
  loadExpenses,
  loadInventory,
  loadMoneyTransactions,
  loadSaleLines,
} from "./queries";

const router: IRouter = Router();

router.get("/reports", async (req, res): Promise<void> => {
  const parsed = GetReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const mode = await getDataMode();
  const filters = {
    mode,
    branchId: parsed.data.branchId,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
  };
  let columns: string[] = [];
  let rows: Array<Record<string, unknown>> = [];
  let total = 0n;

  switch (parsed.data.reportType) {
    case "sales": {
      const sales = await loadSaleLines(filters);
      columns = ["Sana", "Chek", "Filial", "Mahsulot", "Miqdor", "Tushum", "Tannarx", "Yalpi foyda", "To‘lov", "Manba"];
      rows = sales.map((sale) => ({
        Sana: sale.date.toISOString(),
        Chek: sale.receiptNo,
        Filial: sale.branchName,
        Mahsulot: sale.productName,
        Miqdor: sale.quantity,
        Tushum: sale.revenue,
        Tannarx: sale.costPrice,
        "Yalpi foyda": sale.grossProfit,
        To‘lov: sale.paymentType,
        Manba: sale.source,
      }));
      total = sales.reduce((sum, sale) => sum + sale.revenueCents, 0n);
      break;
    }
    case "inventory": {
      const inventory = await loadInventory(filters);
      columns = ["Filial", "Mahsulot", "Guruh", "Shtrix-kod", "Qoldiq", "Tannarx", "Qiymat", "Yaroqlilik muddati"];
      rows = inventory.map((item) => ({
        Filial: item.branchName,
        Mahsulot: item.productName,
        Guruh: item.group,
        "Shtrix-kod": item.barcode,
        Qoldiq: item.quantity,
        Tannarx: item.costPrice,
        Qiymat: item.value,
        "Yaroqlilik muddati": item.expiryDate,
      }));
      total = inventory.reduce((sum, item) => sum + moneyCents(item.value), 0n);
      break;
    }
    case "expenses": {
      const expenses = await loadExpenses(filters);
      columns = ["Sana", "Filial", "Toifa", "Izoh", "Summa", "Manba"];
      rows = expenses.map((expense) => ({
        Sana: expense.date,
        Filial: expense.branchName,
        Toifa: expense.category,
        Izoh: expense.description,
        Summa: expense.amount,
        Manba: expense.source,
      }));
      total = expenses.reduce((sum, expense) => sum + moneyCents(expense.amount), 0n);
      break;
    }
    case "debts": {
      const debts = await loadDebts(filters);
      columns = ["Turi", "Qarzdor yoki yetkazib beruvchi", "Hujjat", "Filial", "Berilgan sana", "To‘lov muddati", "Boshlang‘ich qarz", "To‘langan", "Qoldiq"];
      rows = debts.map((debt) => ({
        Turi: debt.kind,
        "Qarzdor yoki yetkazib beruvchi": debt.counterparty,
        Hujjat: debt.documentNo,
        Filial: debt.branchName,
        "Berilgan sana": debt.issuedDate,
        "To‘lov muddati": debt.dueDate,
        "Boshlang‘ich qarz": debt.initialAmount,
        To‘langan: debt.paidAmount,
        Qoldiq: debt.balance,
      }));
      total = debts.reduce((sum, debt) => sum + moneyCents(debt.balance), 0n);
      break;
    }
    case "cashflow": {
      const transactions = await loadMoneyTransactions(filters);
      columns = ["Sana", "Turi", "Hisob", "Filial", "Yo‘nalish", "Summa", "Hujjat", "Izoh"];
      rows = transactions.map((item) => ({
        Sana: item.date.toISOString(),
        Turi: item.type,
        Hisob: item.accountName,
        Filial: item.branchName,
        Yo‘nalish: item.transferGroupId
          ? "Ichki o‘tkazma"
          : item.direction === "in"
            ? "Kirim"
            : "Chiqim",
        Summa: item.amount,
        Hujjat: item.documentNo,
        Izoh: item.note,
      }));
      total = transactions.reduce((sum, item) => {
        if (item.transferGroupId || item.direction === "internal") return sum;
        return item.direction === "in"
          ? sum + moneyCents(item.amount)
          : sum - moneyCents(item.amount);
      }, 0n);
      break;
    }
    case "profit": {
      const [branches, sales, expenses] = await Promise.all([
        db
          .select()
          .from(branchesTable)
          .where(
            and(
              sourceCondition(branchesTable.source, mode),
              parsed.data.branchId
                ? eq(branchesTable.id, parsed.data.branchId)
                : undefined,
            ),
          )
          .orderBy(asc(branchesTable.name)),
        loadSaleLines(filters),
        loadExpenses(filters),
      ]);
      const rowsMissingCost = sales.some((sale) => sale.grossProfit == null);
      const grossByBranch = new Map<number, bigint>();
      const salesByBranch = new Map<number, bigint>();
      for (const sale of sales) {
        salesByBranch.set(
          sale.branchId,
          (salesByBranch.get(sale.branchId) ?? 0n) + sale.revenueCents,
        );
        if (sale.grossProfit != null) {
          grossByBranch.set(
            sale.branchId,
            (grossByBranch.get(sale.branchId) ?? 0n) +
              moneyCents(sale.grossProfit),
          );
        }
      }
      const expenseByBranch = new Map<number, bigint>();
      for (const expense of expenses) {
        expenseByBranch.set(
          expense.branchId,
          (expenseByBranch.get(expense.branchId) ?? 0n) +
            moneyCents(expense.amount),
        );
      }
      columns = ["Filial", "Sof sotuv", "Tovar tannarxi", "Yalpi foyda", "Xarajatlar", "Dastlabki foyda", "Holat"];
      rows = branches.map((branch) => {
        const branchSales = salesByBranch.get(branch.id) ?? 0n;
        const branchGross = grossByBranch.get(branch.id);
        const branchExpense = expenseByBranch.get(branch.id) ?? 0n;
        const isIncomplete = branchGross == null && sales.some((sale) => sale.branchId === branch.id && sale.grossProfit == null);
        return {
          Filial: branch.name,
          "Sof sotuv": centsMoney(branchSales),
          "Tovar tannarxi": branchGross == null ? null : centsMoney(branchSales - branchGross),
          "Yalpi foyda": isIncomplete ? null : centsMoney(branchGross ?? 0n),
          Xarajatlar: centsMoney(branchExpense),
          "Dastlabki foyda":
            isIncomplete ? null : centsMoney((branchGross ?? 0n) - branchExpense),
          Holat: rowsMissingCost ? "Dastlabki hisob" : "Hisoblandi",
        };
      });
      total = rows.reduce((sum, row) => {
        const value = row["Dastlabki foyda"];
        return typeof value === "string" ? sum + moneyCents(value) : sum;
      }, 0n);
      break;
    }
  }

  const response = {
    reportType: parsed.data.reportType,
    mode,
    columns,
    rows,
    total: centsMoney(total),
    updatedAt: new Date(),
  };
  res.json(GetReportResponse.parse(response));
});

export default router;
