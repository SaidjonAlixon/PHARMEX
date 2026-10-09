import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  branchesTable,
  cashAccountsTable,
  db,
  expensesTable,
  moneyTransactionsTable,
} from "@workspace/db";
import {
  CreateCashAccountBody,
  CreateCashAccountResponse,
  CreateExpenseBody,
  CreateExpenseResponse,
  CreateMoneyOperationBody,
  CreateMoneyOperationResponse,
  CreateMoneyTransferBody,
  CreateMoneyTransferResponse,
  GetCashRegisterQueryParams,
  GetCashRegisterResponse,
  ListCashAccountsQueryParams,
  ListCashAccountsResponse,
  ListExpensesQueryParams,
  ListExpensesResponse,
  ListMoneyTransactionsQueryParams,
  ListMoneyTransactionsResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";
import {
  actorOf,
  applyDebtOperation,
  audit,
  defaultAccount,
  fail,
  lockAccount,
  lockDebt,
  postMoney,
  requireBranch,
  type Tx,
} from "../lib/ledger";
import {
  centsMoney,
  dateConditions,
  dateOnly,
  getDataMode,
  moneyCents,
  sourceCondition,
} from "./financialUtils";
import {
  loadCashAccounts,
  loadExpenses,
  loadMoneyTransactions,
} from "./queries";

const router: IRouter = Router();
const writers = requireRole("admin", "finance");

async function moneyRow(id: number) {
  const [row] = await loadMoneyTransactions({ mode: "live", ids: [id] });
  return row;
}

async function recordExpense(
  tx: Tx,
  input: {
    date: string;
    branchId: number;
    category: string;
    description: string;
    amountCents: bigint;
    accountId: number;
    createdBy: string;
    counterpartyName?: string;
  },
) {
  const [expense] = await tx
    .insert(expensesTable)
    .values({
      date: input.date,
      branchId: input.branchId,
      category: input.category,
      description: input.description,
      amount: centsMoney(input.amountCents),
      accountId: input.accountId,
      source: "manual",
      status: "confirmed",
    })
    .returning();
  const money = await postMoney(tx, {
    accountId: input.accountId,
    direction: "out",
    amountCents: input.amountCents,
    date: new Date(`${input.date}T12:00:00.000Z`),
    type: "expense",
    category: input.category,
    branchId: input.branchId,
    counterpartyName: input.counterpartyName ?? "",
    documentNo: `EXP-${expense.id}`,
    note: input.description || input.category,
    createdBy: input.createdBy,
  });
  return { expense, money };
}

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

router.post("/expenses", writers, async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = actorOf(res.locals);
  const date = dateOnly(parsed.data.date);
  const created = await db.transaction(async (tx) => {
    const branch = await requireBranch(tx, parsed.data.branchId);
    const account = parsed.data.accountId
      ? await lockAccount(tx, parsed.data.accountId)
      : await defaultAccount(tx, branch.id, "cash");
    if (!account) {
      fail("Bu filial uchun kassa hisobi topilmadi. Avval “Pul operatsiyalari” bo‘limida kassa oching.");
    }
    const { expense } = await recordExpense(tx, {
      date,
      branchId: branch.id,
      category: parsed.data.category,
      description: parsed.data.description,
      amountCents: moneyCents(parsed.data.amount),
      accountId: account.id,
      createdBy: actor.name,
    });
    await audit(tx, actor.id, "expense.created", "expense", expense.id, `${expense.category}: ${expense.amount} UZS`);
    return { ...expense, branchName: branch.name };
  });
  res.status(201).json(CreateExpenseResponse.parse(created));
});

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

router.post("/cash-accounts", writers, async (req, res): Promise<void> => {
  const parsed = CreateCashAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = actorOf(res.locals);
  const account = await db.transaction(async (tx) => {
    if (parsed.data.branchId) await requireBranch(tx, parsed.data.branchId);
    if (parsed.data.kind === "cash" && !parsed.data.branchId) {
      fail("Naqd kassa filialga biriktirilishi kerak.", 400);
    }
    const [created] = await tx
      .insert(cashAccountsTable)
      .values({
        name: parsed.data.name.trim(),
        kind: parsed.data.kind,
        branchId: parsed.data.branchId ?? null,
        openingBalance: parsed.data.openingBalance,
        source: "manual",
      })
      .returning();
    await audit(tx, actor.id, "cash_account.created", "cash_account", created.id, `${created.name} (${created.kind}) ochildi, boshlang‘ich qoldiq ${created.openingBalance}`);
    return created;
  });
  const [row] = (await loadCashAccounts({ mode: "live" })).filter(
    (item) => item.id === account.id,
  );
  res.status(201).json(CreateCashAccountResponse.parse(row));
});

router.get("/cash-register", async (req, res): Promise<void> => {
  const parsed = GetCashRegisterQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const mode = await getDataMode();
  const accounts = await db
    .select({
      id: cashAccountsTable.id,
      name: cashAccountsTable.name,
      kind: cashAccountsTable.kind,
      branchId: cashAccountsTable.branchId,
      branchName: branchesTable.name,
      openingBalance: cashAccountsTable.openingBalance,
    })
    .from(cashAccountsTable)
    .leftJoin(branchesTable, eq(branchesTable.id, cashAccountsTable.branchId))
    .where(
      and(
        sourceCondition(cashAccountsTable.source, mode),
        parsed.data.branchId
          ? eq(cashAccountsTable.branchId, parsed.data.branchId)
          : undefined,
      ),
    );
  const signed = sql<string>`coalesce(sum(case when ${moneyTransactionsTable.direction} = 'in' then ${moneyTransactionsTable.amount} when ${moneyTransactionsTable.direction} = 'out' then -${moneyTransactionsTable.amount} else 0 end), 0)::text`;
  const before = parsed.data.dateFrom
    ? await db
        .select({ accountId: moneyTransactionsTable.accountId, net: signed })
        .from(moneyTransactionsTable)
        .where(lt(moneyTransactionsTable.date, parsed.data.dateFrom))
        .groupBy(moneyTransactionsTable.accountId)
    : [];
  const period = await db
    .select({
      accountId: moneyTransactionsTable.accountId,
      inflow: sql<string>`coalesce(sum(case when ${moneyTransactionsTable.direction} = 'in' then ${moneyTransactionsTable.amount} else 0 end), 0)::text`,
      outflow: sql<string>`coalesce(sum(case when ${moneyTransactionsTable.direction} = 'out' then ${moneyTransactionsTable.amount} else 0 end), 0)::text`,
      cashSales: sql<string>`coalesce(sum(case when ${moneyTransactionsTable.type} = 'sale' and ${moneyTransactionsTable.direction} = 'in' then ${moneyTransactionsTable.amount} else 0 end), 0)::text`,
      encashment: sql<string>`coalesce(sum(case when ${moneyTransactionsTable.type} = 'encashment' and ${moneyTransactionsTable.direction} = 'out' then ${moneyTransactionsTable.amount} else 0 end), 0)::text`,
      operations: sql<number>`count(*)::int`,
    })
    .from(moneyTransactionsTable)
    .where(dateConditions(moneyTransactionsTable.date, parsed.data.dateFrom, parsed.data.dateTo))
    .groupBy(moneyTransactionsTable.accountId);
  const beforeById = new Map(before.map((row) => [row.accountId, moneyCents(row.net)]));
  const periodById = new Map(period.map((row) => [row.accountId, row]));
  const rows = accounts.map((account) => {
    const opening =
      moneyCents(account.openingBalance) + (beforeById.get(account.id) ?? 0n);
    const current = periodById.get(account.id);
    const inflow = moneyCents(current?.inflow ?? "0");
    const outflow = moneyCents(current?.outflow ?? "0");
    return {
      accountId: account.id,
      accountName: account.name,
      kind: account.kind,
      branchId: account.branchId,
      branchName: account.branchName ?? "Kompaniya",
      openingBalance: centsMoney(opening),
      inflow: centsMoney(inflow),
      outflow: centsMoney(outflow),
      closingBalance: centsMoney(opening + inflow - outflow),
      operations: current?.operations ?? 0,
      cashSales: centsMoney(moneyCents(current?.cashSales ?? "0")),
      encashment: centsMoney(moneyCents(current?.encashment ?? "0")),
    };
  });
  res.json(GetCashRegisterResponse.parse(rows));
});

const operationDirection = {
  cash_in: "in",
  cash_out: "out",
  bank_receipt: "in",
  supplier_payment: "out",
  customer_payment: "in",
  expense: "out",
  owner_in: "in",
  owner_out: "out",
} as const;

router.post("/money-operations", writers, async (req, res): Promise<void> => {
  const parsed = CreateMoneyOperationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const actor = actorOf(res.locals);
  const amountCents = moneyCents(input.amount);
  const moneyId = await db.transaction(async (tx) => {
    const account = await lockAccount(tx, input.accountId);
    if (input.type === "bank_receipt" && account.kind !== "bank") {
      fail("Bank tushumi faqat bank hisobiga yoziladi.", 400);
    }
    const branchId = input.branchId ?? account.branchId ?? null;
    if (branchId) await requireBranch(tx, branchId);

    if (input.type === "expense") {
      if (!input.category?.trim()) fail("Xarajat turini tanlang.", 400);
      if (!branchId) fail("Xarajat qaysi filialga tegishli ekanini tanlang.", 400);
      const { expense, money } = await recordExpense(tx, {
        date: dateOnly(input.date),
        branchId,
        category: input.category.trim(),
        description: input.note ?? "",
        amountCents,
        accountId: account.id,
        createdBy: actor.name,
        counterpartyName: input.counterpartyName,
      });
      await audit(tx, actor.id, "expense.created", "expense", expense.id, `${expense.category}: ${expense.amount} UZS`);
      return money.id;
    }

    if (
      (input.type === "supplier_payment" || input.type === "customer_payment") &&
      input.debtId
    ) {
      const debt = await lockDebt(tx, input.debtId);
      const expected = input.type === "supplier_payment" ? "payable" : "receivable";
      if (debt.kind !== expected) {
        fail(
          input.type === "supplier_payment"
            ? "Tanlangan hujjat kreditorlik qarzi emas."
            : "Tanlangan hujjat debitorlik qarzi emas.",
          400,
        );
      }
      const { operation } = await applyDebtOperation(tx, {
        debtId: debt.id,
        kind: "payment",
        amountCents,
        date: input.date,
        accountId: account.id,
        note: input.note ?? "",
        createdBy: actor.name,
      });
      await audit(tx, actor.id, "debt.payment", "debt", debt.id, `${debt.counterparty}: ${centsMoney(amountCents)} UZS to‘lov`);
      return operation.moneyTransactionId!;
    }

    const money = await postMoney(tx, {
      accountId: account.id,
      direction: operationDirection[input.type],
      amountCents,
      date: input.date,
      type: input.type,
      category: input.category?.trim() ?? "",
      branchId,
      counterpartyName: input.counterpartyName?.trim() ?? "",
      documentNo: input.documentNo?.trim() ?? "",
      note: input.note?.trim() ?? "",
      createdBy: actor.name,
    });
    await audit(tx, actor.id, "money.operation", "money_transaction", money.id, `${input.type}: ${money.amount} UZS (${account.name})`);
    return money.id;
  });
  res.status(201).json(CreateMoneyOperationResponse.parse(await moneyRow(moneyId)));
});

router.post("/money-transfers", writers, async (req, res): Promise<void> => {
  const parsed = CreateMoneyTransferBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  if (input.fromAccountId === input.toAccountId) {
    res.status(400).json({ error: "Bir hisobdan o‘ziga o‘tkazib bo‘lmaydi." });
    return;
  }
  const actor = actorOf(res.locals);
  const kind = input.kind ?? "transfer";
  const amountCents = moneyCents(input.amount);
  const ids = await db.transaction(async (tx) => {
    const [first, second] =
      input.fromAccountId < input.toAccountId
        ? [input.fromAccountId, input.toAccountId]
        : [input.toAccountId, input.fromAccountId];
    await lockAccount(tx, first);
    await lockAccount(tx, second);
    const from = await lockAccount(tx, input.fromAccountId);
    const to = await lockAccount(tx, input.toAccountId);
    if (kind === "encashment" && (from.kind !== "cash" || to.kind !== "bank")) {
      fail("Inkassatsiya faqat kassadan bank hisobiga bo‘ladi.", 400);
    }
    const transferGroupId = randomUUID();
    const common = {
      amountCents,
      date: input.date,
      type: kind,
      transferGroupId,
      note: input.note,
      createdBy: actor.name,
    };
    const out = await postMoney(tx, {
      ...common,
      accountId: from.id,
      direction: "out",
      counterpartyName: to.name,
    });
    const incoming = await postMoney(tx, {
      ...common,
      accountId: to.id,
      direction: "in",
      counterpartyName: from.name,
    });
    await audit(tx, actor.id, `money.${kind}`, "money_transaction", out.id, `${from.name} → ${to.name}: ${out.amount} UZS`);
    return [out.id, incoming.id] as const;
  });
  res.status(201).json(
    CreateMoneyTransferResponse.parse({
      from: await moneyRow(ids[0]),
      to: await moneyRow(ids[1]),
    }),
  );
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
    accountId: parsed.data.accountId,
    type: parsed.data.type,
    direction: parsed.data.direction,
    search: parsed.data.search,
  });
  res.json(ListMoneyTransactionsResponse.parse(rows));
});

export default router;
