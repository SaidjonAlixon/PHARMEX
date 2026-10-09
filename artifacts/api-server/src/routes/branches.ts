import { and, asc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  auditLogTable,
  branchesTable,
  db,
  expensesTable,
} from "@workspace/db";
import {
  CreateBranchBody,
  CreateBranchResponse,
  GetBranchQueryParams,
  GetBranchResponse,
  ListBranchesResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";
import { loadCashAccounts, loadDebts, loadExpenses, loadInventory, loadSaleLines } from "./queries";
import {
  centsMoney,
  dateConditions,
  getDataMode,
  moneyCents,
  sourceCondition,
} from "./financialUtils";
import { saleItemsTable, salesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/branches", async (_req, res): Promise<void> => {
  const mode = await getDataMode();
  const rows = await db
    .select()
    .from(branchesTable)
    .where(sourceCondition(branchesTable.source, mode))
    .orderBy(asc(branchesTable.name));
  res.json(ListBranchesResponse.parse(rows));
});

router.post(
  "/branches",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    const parsed = CreateBranchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [branch] = await db
      .insert(branchesTable)
      .values({ ...parsed.data, source: "manual" })
      .returning();
    await db.insert(auditLogTable).values({
      actorId: String(res.locals.userId),
      action: "branch.created",
      entityType: "branch",
      entityId: String(branch.id),
      summary: `Yangi filial ro‘yxatga olindi: ${branch.name}`,
    });
    res.status(201).json(CreateBranchResponse.parse(branch));
  },
);

router.get("/branch-detail", async (req, res): Promise<void> => {
  const parsed = GetBranchQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const mode = await getDataMode();
  const [branch] = await db
    .select()
    .from(branchesTable)
    .where(eq(branchesTable.id, parsed.data.branchId))
    .limit(1);

  if (!branch || (mode === "live" && branch.source === "demo")) {
    res.status(404).json({ error: "Filial topilmadi." });
    return;
  }

  const filters = {
    mode,
    branchId: branch.id,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
  };
  const [allSales, expenses, accounts, inventory, debts] = await Promise.all([
    loadSaleLines(filters),
    loadExpenses(filters),
    loadCashAccounts(filters),
    loadInventory(filters),
    loadDebts(filters),
  ]);
  const allCostsKnown = allSales.every((sale) => sale.costCents !== null);
  const revenue = allSales.reduce((sum, sale) => sum + sale.revenueCents, 0n);
  const grossProfit = allCostsKnown
    ? allSales.reduce((sum, sale) => sum + (sale.grossProfit == null ? 0n : moneyCents(sale.grossProfit)), 0n)
    : null;
  const expensesTotal = expenses.reduce((sum, expense) => sum + moneyCents(expense.amount), 0n);
  const inventoryValue = inventory.some((item) => item.value == null)
    ? null
    : inventory.reduce((sum, item) => sum + moneyCents(item.value), 0n);
  const cashBalance = accounts.reduce((sum, account) => sum + moneyCents(account.balance), 0n);
  const payable = debts
    .filter((debt) => debt.kind === "payable")
    .reduce((sum, debt) => sum + moneyCents(debt.balance), 0n);
  const receivable = debts
    .filter((debt) => debt.kind === "receivable")
    .reduce((sum, debt) => sum + moneyCents(debt.balance), 0n);

  const recentSaleRows = await loadSaleLines({ ...filters, limit: 10 });
  const recentSales = recentSaleRows.map(({ costCents: _costCents, revenueCents: _revenueCents, ...sale }) => sale);
  const result = {
    branch,
    summary: {
      sales: centsMoney(revenue),
      grossProfit: grossProfit == null ? null : centsMoney(grossProfit),
      expenses: centsMoney(expensesTotal),
      cashBalance: centsMoney(cashBalance),
      inventoryValue: inventoryValue == null ? null : centsMoney(inventoryValue),
      payable: centsMoney(payable),
      receivable: centsMoney(receivable),
    },
    recentSales,
    expenses,
  };
  res.json(GetBranchResponse.parse(result));
});

export default router;
