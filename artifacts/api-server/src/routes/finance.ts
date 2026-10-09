import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  auditLogTable,
  branchesTable,
  cashAccountsTable,
  db,
  expensesTable,
  moneyTransactionsTable,
} from "@workspace/db";
import {
  CreateExpenseBody,
  CreateExpenseResponse,
  ListCashAccountsQueryParams,
  ListCashAccountsResponse,
  ListDebtsQueryParams,
  ListDebtsResponse,
  ListExpensesQueryParams,
  ListExpensesResponse,
  ListMoneyTransactionsQueryParams,
  ListMoneyTransactionsResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";
import { centsMoney, dateOnly, getDataMode, moneyCents } from "./financialUtils";
import {
  loadCashAccounts,
  loadDebts,
  loadExpenses,
  loadMoneyTransactions,
} from "./queries";

const router: IRouter = Router();

router.get("/expenses", async (req, res): Promise<void> => {
  const parsed = ListExpensesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await loadExpenses({
    mode: await getDataMode(),
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    branchId: parsed.data.branchId,
    category: parsed.data.category,
  });
  res.json(ListExpensesResponse.parse(rows));
});

router.post(
  "/expenses",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    const parsed = CreateExpenseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [cashAccount] = await db
      .select()
      .from(cashAccountsTable)
      .where(
        and(
          eq(cashAccountsTable.branchId, parsed.data.branchId),
          eq(cashAccountsTable.kind, "cash"),
        ),
      )
      .limit(1);
    if (!cashAccount) {
      res.status(422).json({
        error: "Bu filial uchun kassa hisobi topilmadi. Avval kassa hisobini sozlang.",
      });
      return;
    }

    const date = dateOnly(parsed.data.date);
    const created = await db.transaction(async (tx) => {
      const [expense] = await tx
        .insert(expensesTable)
        .values({
          date,
          branchId: parsed.data.branchId,
          category: parsed.data.category,
          description: parsed.data.description,
          amount: parsed.data.amount,
          source: "manual",
          status: "confirmed",
        })
        .returning();
      await tx.insert(moneyTransactionsTable).values({
        date: new Date(`${date}T12:00:00.000Z`),
        type: "Xarajat",
        amount: parsed.data.amount,
        direction: "out",
        accountId: cashAccount.id,
        branchId: parsed.data.branchId,
        documentNo: `EXP-${expense.id}`,
        note: parsed.data.description || parsed.data.category,
        source: "manual",
      });
      await tx.insert(auditLogTable).values({
        actorId: String(res.locals.userId),
        action: "expense.created",
        entityType: "expense",
        entityId: String(expense.id),
        summary: `${expense.category}: ${expense.amount} UZS`,
      });
      return expense;
    });

    const [branch] = await db
      .select({ branchName: branchesTable.name })
      .from(branchesTable)
      .where(eq(branchesTable.id, created.branchId))
      .limit(1);
    res.status(201).json(
      CreateExpenseResponse.parse({
        ...created,
        branchName: branch?.branchName ?? "",
      }),
    );
  },
);

router.get("/cash-accounts", async (req, res): Promise<void> => {
  const parsed = ListCashAccountsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await loadCashAccounts({
    mode: await getDataMode(),
    branchId: parsed.data.branchId,
  });
  res.json(ListCashAccountsResponse.parse(rows));
});

router.get("/money-transactions", async (req, res): Promise<void> => {
  const parsed = ListMoneyTransactionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await loadMoneyTransactions({
    mode: await getDataMode(),
    branchId: parsed.data.branchId,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
  });
  res.json(ListMoneyTransactionsResponse.parse(rows));
});

router.get("/debts", async (req, res): Promise<void> => {
  const parsed = ListDebtsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await loadDebts({
    mode: await getDataMode(),
    branchId: parsed.data.branchId,
    kind: parsed.data.kind,
    search: parsed.data.search,
  });
  res.json(ListDebtsResponse.parse(rows));
});

export default router;
