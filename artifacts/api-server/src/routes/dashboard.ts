import {
  and,
  asc,
  eq,
  gte,
  lt,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  branchesTable,
  db,
  inventoryMovementsTable,
} from "@workspace/db";
import {
  GetDashboardQueryParams,
  GetDashboardResponse,
} from "@workspace/api-zod";
import {
  centsMoney,
  dateOnly,
  extendedMoney,
  getDataMode,
  moneyCents,
  sourceCondition,
  toNumber,
} from "./financialUtils";
import {
  loadCashAccounts,
  loadDebts,
  loadExpenses,
  loadInventory,
  loadMoneyTransactions,
  loadSaleLines,
} from "./queries";

const router: IRouter = Router();
const zero = "0.00";

router.get("/dashboard", async (req, res): Promise<void> => {
  const parsed = GetDashboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const now = new Date();
  const dateFrom =
    parsed.data.dateFrom ??
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dateTo =
    parsed.data.dateTo ??
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mode = await getDataMode();
  const filters = {
    mode,
    branchId: parsed.data.branchId,
    dateFrom,
    dateTo,
  };

  if (mode === "empty") {
    const empty = {
      mode,
      completeness: "insufficient",
      updatedAt: now,
      totals: {
        sales: null,
        netSales: null,
        grossProfit: null,
        netProfit: null,
        expenses: null,
        cash: null,
        cashBalance: null,
        bankBalance: null,
        inventoryValue: null,
        payable: null,
        receivable: null,
        overdueDebt: null,
        goodsIn: null,
        goodsOut: null,
      },
      salesTrend: [],
      branchComparison: [],
      expenseBreakdown: [],
      moneyFlow: [],
      topProducts: [],
      alerts: [
        {
          id: "waiting-fom",
          severity: "info",
          title: "Ma’lumot kutilmoqda",
          description:
            "Hali filial yoki moliyaviy yozuv yo‘q. FOM ulanishi Sozlamalarda sozlanadi.",
          target: "/settings",
        },
      ],
    };
    res.json(GetDashboardResponse.parse(empty));
    return;
  }

  const [sales, expenses, accounts, inventory, debts, transactions, branches] =
    await Promise.all([
      loadSaleLines(filters),
      loadExpenses(filters),
      loadCashAccounts(filters),
      loadInventory({ mode, branchId: parsed.data.branchId }),
      loadDebts({ mode, branchId: parsed.data.branchId }),
      loadMoneyTransactions(filters),
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
    ]);

  const revenue = sales.reduce((sum, sale) => sum + sale.revenueCents, 0n);
  const grossKnown = sales.every((sale) => sale.costCents !== null);
  const grossProfit = grossKnown
    ? sales.reduce(
        (sum, sale) =>
          sum + (sale.grossProfit == null ? 0n : moneyCents(sale.grossProfit)),
        0n,
      )
    : null;
  const totalExpenses = expenses.reduce(
    (sum, expense) => sum + moneyCents(expense.amount),
    0n,
  );
  const cashBalance = accounts
    .filter((account) => account.kind === "cash")
    .reduce((sum, account) => sum + moneyCents(account.balance), 0n);
  const bankBalance = accounts
    .filter((account) => account.kind === "bank")
    .reduce((sum, account) => sum + moneyCents(account.balance), 0n);
  const inventoryUnknown = inventory.some((item) => item.value == null);
  const inventoryValue = inventoryUnknown
    ? null
    : inventory.reduce((sum, item) => sum + moneyCents(item.value), 0n);
  const payable = debts
    .filter((debt) => debt.kind === "payable")
    .reduce((sum, debt) => sum + moneyCents(debt.balance), 0n);
  const receivable = debts
    .filter((debt) => debt.kind === "receivable")
    .reduce((sum, debt) => sum + moneyCents(debt.balance), 0n);
  const companyCash = cashBalance + bankBalance;
  const approximateProfit =
    grossProfit == null ? null : grossProfit - totalExpenses;

  const trends = new Map<
    string,
    { sales: bigint; cost: bigint; gross: bigint; costsKnown: boolean }
  >();
  for (const sale of sales) {
    const label = dateOnly(sale.date);
    const entry = trends.get(label) ?? {
      sales: 0n,
      cost: 0n,
      gross: 0n,
      costsKnown: true,
    };
    entry.sales += sale.revenueCents;
    if (sale.costCents == null) {
      entry.costsKnown = false;
    } else {
      entry.cost += sale.costCents;
      entry.gross += moneyCents(sale.grossProfit ?? zero);
    }
    trends.set(label, entry);
  }
  const expenseByDay = new Map<string, bigint>();
  for (const expense of expenses) {
    const label = dateOnly(expense.date);
    expenseByDay.set(
      label,
      (expenseByDay.get(label) ?? 0n) + moneyCents(expense.amount),
    );
  }
  const salesTrend = [...trends.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, item]) => {
      const expensesForDay = expenseByDay.get(label) ?? 0n;
      return {
        label,
        sales: centsMoney(item.sales),
        cost: centsMoney(item.cost),
        grossProfit: centsMoney(item.gross),
        netProfit: item.costsKnown
          ? centsMoney(item.gross - expensesForDay)
          : null,
      };
    });

  const expenseGroups = new Map<string, bigint>();
  for (const expense of expenses) {
    expenseGroups.set(
      expense.category,
      (expenseGroups.get(expense.category) ?? 0n) + moneyCents(expense.amount),
    );
  }
  const expenseBreakdown = [...expenseGroups.entries()]
    .sort(([, left], [, right]) => (left > right ? -1 : left < right ? 1 : 0))
    .map(([label, value]) => ({ label, value: centsMoney(value) }));

  const flowGroups = new Map<string, { inflow: bigint; outflow: bigint }>();
  for (const transaction of transactions) {
    if (transaction.transferGroupId) continue;
    const label = dateOnly(transaction.date);
    const entry = flowGroups.get(label) ?? { inflow: 0n, outflow: 0n };
    if (transaction.direction === "in") {
      entry.inflow += moneyCents(transaction.amount);
    } else if (transaction.direction === "out") {
      entry.outflow += moneyCents(transaction.amount);
    }
    flowGroups.set(label, entry);
  }
  const moneyFlow = [...flowGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, item]) => ({
      label,
      inflow: centsMoney(item.inflow),
      outflow: centsMoney(item.outflow),
    }));

  const products = new Map<
    number,
    { name: string; quantity: number; sales: bigint; gross: bigint; costsKnown: boolean }
  >();
  for (const sale of sales) {
    const product = products.get(sale.productId) ?? {
      name: sale.productName,
      quantity: 0,
      sales: 0n,
      gross: 0n,
      costsKnown: true,
    };
    product.quantity += sale.quantity;
    product.sales += sale.revenueCents;
    if (sale.costCents == null) product.costsKnown = false;
    else product.gross += moneyCents(sale.grossProfit ?? zero);
    products.set(sale.productId, product);
  }
  const topProducts = [...products.entries()]
    .sort(([, left], [, right]) =>
      left.sales > right.sales ? -1 : left.sales < right.sales ? 1 : 0,
    )
    .slice(0, 8)
    .map(([productId, product]) => ({
      productId,
      name: product.name,
      quantity: product.quantity,
      sales: centsMoney(product.sales),
      grossProfit: product.costsKnown ? centsMoney(product.gross) : null,
    }));

  const today = dateOnly(now);
  const overdue = debts.filter(
    (debt) => debt.balance !== zero && debt.balance !== "0.00" && debt.dueDate < today,
  );
  const alerts = [];
  if (overdue.length) {
    alerts.push({
      id: "overdue-debts",
      severity: "critical" as const,
      title: "Muddati o‘tgan qarzlar",
      description: `${overdue.length} ta hujjat bo‘yicha to‘lov muddati o‘tgan.`,
      target: "/debts",
    });
  }
  const negativeStocks = inventory.filter((item) => item.quantity < 0);
  if (negativeStocks.length) {
    alerts.push({
      id: "negative-stock",
      severity: "critical" as const,
      title: "Manfiy tovar qoldig‘i",
      description: `${negativeStocks.length} ta mahsulotda qoldiq manfiy.`,
      target: "/trade",
    });
  }
  const expiring = inventory.filter((item) => {
    if (!item.expiryDate) return false;
    const expiry = new Date(item.expiryDate);
    return expiry.getTime() >= now.getTime() &&
      expiry.getTime() < now.getTime() + 30 * 24 * 60 * 60 * 1000;
  });
  if (expiring.length) {
    alerts.push({
      id: "near-expiry",
      severity: "warning" as const,
      title: "Yaroqlilik muddati yaqin",
      description: `${expiring.length} ta mahsulotning muddati 30 kun ichida tugaydi.`,
      target: "/trade",
    });
  }
  if (!grossKnown) {
    alerts.push({
      id: "missing-cost",
      severity: "warning" as const,
      title: "Tannarxi kiritilmagan sotuvlar",
      description: "Tannarx yetishmagani sababli yalpi va sof foyda to‘liq emas.",
      target: "/profit",
    });
  }
  alerts.push({
    id: "fom-not-connected",
    severity: "info" as const,
    title: "FOM integratsiyasi ulanmagan",
    description: "Sinov yoki qo‘lda kiritilgan ma’lumotlar ko‘rsatilmoqda.",
    target: "/settings",
  });

  const branchComparison = await Promise.all(
    branches.map(async (branch) => {
      const branchFilter = { ...filters, branchId: branch.id };
      const [branchSales, branchExpenses, branchAccounts, branchInventory, branchDebts] =
        await Promise.all([
          loadSaleLines(branchFilter),
          loadExpenses(branchFilter),
          loadCashAccounts(branchFilter),
          loadInventory({ mode, branchId: branch.id }),
          loadDebts({ mode, branchId: branch.id }),
        ]);
      const branchRevenue = branchSales.reduce((sum, sale) => sum + sale.revenueCents, 0n);
      const branchCostsKnown = branchSales.every((sale) => sale.costCents !== null);
      const branchGross = branchCostsKnown
        ? branchSales.reduce(
            (sum, sale) =>
              sum + (sale.grossProfit == null ? 0n : moneyCents(sale.grossProfit)),
            0n,
          )
        : null;
      const branchExpenseTotal = branchExpenses.reduce(
        (sum, expense) => sum + moneyCents(expense.amount),
        0n,
      );
      const branchInventory = branchInventory.some((item) => item.value == null)
        ? null
        : branchInventory.reduce((sum, item) => sum + moneyCents(item.value), 0n);
      const branchCash = branchAccounts.reduce(
        (sum, account) => sum + moneyCents(account.balance),
        0n,
      );
      const branchDebt = branchDebts.reduce(
        (sum, debt) => sum + moneyCents(debt.balance),
        0n,
      );
      return {
        id: branch.id,
        name: branch.name,
        sales: centsMoney(branchRevenue),
        grossProfit: branchGross == null ? null : centsMoney(branchGross),
        netProfit:
          branchGross == null
            ? null
            : centsMoney(branchGross - branchExpenseTotal),
        expenses: centsMoney(branchExpenseTotal),
        cashBalance: centsMoney(branchCash),
        inventoryValue: branchInventory == null ? null : centsMoney(branchInventory),
        debt: centsMoney(branchDebt),
        updatedAt: branch.updatedAt,
      };
    }),
  );

  const modeLabel = mode === "demo";
  const result = {
    mode,
    completeness:
      grossKnown && expenses.length > 0 && !modeLabel
        ? "complete"
        : "preliminary",
    updatedAt: now,
    totals: {
      sales: centsMoney(
        sales.reduce(
          (sum, sale) => sum + extendedMoney(sale.unitPrice, sale.quantity),
          0n,
        ),
      ),
      netSales: centsMoney(revenue),
      grossProfit: grossProfit == null ? null : centsMoney(grossProfit),
      netProfit: approximateProfit == null ? null : centsMoney(approximateProfit),
      expenses: centsMoney(totalExpenses),
      cash: centsMoney(companyCash),
      cashBalance: centsMoney(cashBalance),
      bankBalance: centsMoney(bankBalance),
      inventoryValue: inventoryValue == null ? null : centsMoney(inventoryValue),
      payable: centsMoney(payable),
      receivable: centsMoney(receivable),
      overdueDebt: centsMoney(
        overdue.reduce((sum, debt) => sum + moneyCents(debt.balance), 0n),
      ),
      goodsIn: null,
      goodsOut: null,
    },
    salesTrend,
    branchComparison,
    expenseBreakdown,
    moneyFlow,
    topProducts,
    alerts,
  };

  const movementStart = dateFrom;
  const movementEnd = new Date(dateTo.getTime() + 24 * 60 * 60 * 1000);
  const movements = await db
    .select({
      movementType: inventoryMovementsTable.movementType,
      quantity: inventoryMovementsTable.quantity,
      unitCost: inventoryMovementsTable.unitCost,
    })
    .from(inventoryMovementsTable)
    .where(
      and(
        sourceCondition(inventoryMovementsTable.source, mode),
        parsed.data.branchId
          ? eq(inventoryMovementsTable.branchId, parsed.data.branchId)
          : undefined,
        gte(inventoryMovementsTable.occurredAt, movementStart),
        lt(inventoryMovementsTable.occurredAt, movementEnd),
      ),
    );
  let goodsIn: bigint | null = 0n;
  let goodsOut: bigint | null = 0n;
  for (const movement of movements) {
    if (movement.movementType === "purchase") {
      if (movement.unitCost == null) goodsIn = null;
      else if (goodsIn != null) {
        goodsIn += extendedMoney(movement.unitCost, movement.quantity);
      }
    } else if (
      movement.movementType === "sale" ||
      movement.movementType === "write_off"
    ) {
      if (movement.unitCost == null) goodsOut = null;
      else if (goodsOut != null) {
        goodsOut += extendedMoney(movement.unitCost, movement.quantity);
      }
    }
  }
  result.totals.goodsIn = goodsIn == null ? null : centsMoney(goodsIn);
  result.totals.goodsOut = goodsOut == null ? null : centsMoney(goodsOut);
  res.json(GetDashboardResponse.parse(result));
});

export default router;
