import { asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  cashAccountsTable,
  db,
  debtPaymentsTable,
  debtsTable,
} from "@workspace/db";
import {
  CreateDebtBody,
  CreateDebtOperationBody,
  CreateDebtOperationResponse,
  CreateDebtResponse,
  GetDebtQueryParams,
  GetDebtResponse,
  ListCounterpartyBalancesQueryParams,
  ListCounterpartyBalancesResponse,
  ListDebtsQueryParams,
  ListDebtsResponse,
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
  requireBranch,
} from "../lib/ledger";
import { centsMoney, getDataMode, moneyCents } from "./financialUtils";
import { loadDebts } from "./queries";

const router: IRouter = Router();

export async function loadDebtDetail(debtId: number) {
  const [debt] = await loadDebts({ mode: await getDataMode(), debtId });
  if (!debt) return null;
  const operations = await db
    .select({
      id: debtPaymentsTable.id,
      kind: debtPaymentsTable.kind,
      date: debtPaymentsTable.date,
      amount: debtPaymentsTable.amount,
      accountName: cashAccountsTable.name,
      note: debtPaymentsTable.note,
      createdBy: debtPaymentsTable.createdBy,
    })
    .from(debtPaymentsTable)
    .leftJoin(cashAccountsTable, eq(cashAccountsTable.id, debtPaymentsTable.accountId))
    .where(eq(debtPaymentsTable.debtId, debtId))
    .orderBy(asc(debtPaymentsTable.date), asc(debtPaymentsTable.id));
  let balance = moneyCents(debt.initialAmount);
  const history = [
    {
      id: 0,
      kind: "initial" as const,
      date: new Date(`${debt.issuedDate}T00:00:00.000Z`),
      amount: debt.initialAmount,
      balanceAfter: centsMoney(balance),
      accountName: "",
      note: debt.note || "Qarz paydo bo‘ldi",
      createdBy: "",
    },
    ...operations.map((operation) => {
      balance -= moneyCents(operation.amount);
      return {
        ...operation,
        kind: operation.kind as "payment" | "return" | "writeoff",
        accountName: operation.accountName ?? "",
        balanceAfter: centsMoney(balance),
      };
    }),
  ];
  return { debt, operations: history };
}

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
    status: parsed.data.status,
    counterpartyId: parsed.data.counterpartyId,
  });
  res.json(ListDebtsResponse.parse(rows));
});

router.post(
  "/debts",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    const parsed = CreateDebtBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    const issuedDate = dateOnlyString(input.issuedDate)!;
    const dueDate = dateOnlyString(input.dueDate)!;
    if (dueDate < issuedDate) {
      res.status(400).json({ error: "To‘lov muddati qarz sanasidan oldin bo‘lishi mumkin emas." });
      return;
    }
    if (moneyCents(input.amount) <= 0n) {
      res.status(400).json({ error: "Qarz summasi noldan katta bo‘lishi kerak." });
      return;
    }
    const actor = actorOf(res.locals);
    const debtId = await db.transaction(async (tx) => {
      await requireBranch(tx, input.branchId);
      const counterparty = await findOrCreateCounterparty(tx, {
        id: input.counterpartyId,
        name: input.counterparty,
        kind: input.kind === "payable" ? "supplier" : "customer",
      });
      const [debt] = await tx
        .insert(debtsTable)
        .values({
          kind: input.kind,
          counterparty: counterparty.name,
          counterpartyId: counterparty.id,
          originType: input.originType ?? "manual",
          documentNo: input.documentNo?.trim() ?? "",
          branchId: input.branchId,
          issuedDate,
          dueDate,
          initialAmount: input.amount,
          note: input.note?.trim() ?? "",
          source: "manual",
        })
        .returning();
      if (!debt.documentNo) {
        await tx
          .update(debtsTable)
          .set({ documentNo: documentNumber("QRZ", debt.id) })
          .where(eq(debtsTable.id, debt.id));
      }
      await audit(tx, actor.id, "debt.created", "debt", debt.id, `${debt.kind === "payable" ? "Kreditorlik" : "Debitorlik"} qarzi: ${debt.counterparty}, ${debt.initialAmount} UZS`);
      return debt.id;
    });
    const detail = await loadDebtDetail(debtId);
    res.status(201).json(CreateDebtResponse.parse(detail!.debt));
  },
);

router.get("/debt-detail", async (req, res): Promise<void> => {
  const parsed = GetDebtQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const detail = await loadDebtDetail(parsed.data.debtId);
  if (!detail) {
    res.status(404).json({ error: "Qarz hujjati topilmadi." });
    return;
  }
  res.json(GetDebtResponse.parse(detail));
});

router.post(
  "/debt-operations",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    const parsed = CreateDebtOperationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    const actor = actorOf(res.locals);
    await db.transaction(async (tx) => {
      if (input.kind !== "payment" && input.accountId) {
        fail("Qaytarish va hisobdan chiqarish pul harakatisiz yoziladi.", 400);
      }
      const { debt, operation } = await applyDebtOperation(tx, {
        debtId: input.debtId,
        kind: input.kind,
        amountCents: moneyCents(input.amount),
        date: input.date,
        accountId: input.accountId,
        note: input.note?.trim() ?? "",
        createdBy: actor.name,
      });
      await audit(tx, actor.id, `debt.${input.kind}`, "debt", debt.id, `${debt.counterparty}: ${operation.amount} UZS`);
    });
    const detail = await loadDebtDetail(input.debtId);
    res.status(201).json(CreateDebtOperationResponse.parse(detail));
  },
);

router.get("/counterparty-balances", async (req, res): Promise<void> => {
  const parsed = ListCounterpartyBalancesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const debts = await loadDebts({
    mode: await getDataMode(),
    branchId: parsed.data.branchId,
    kind: parsed.data.kind,
  });
  const groups = new Map<
    string,
    {
      counterparty: string;
      counterpartyId: number | null;
      kind: string;
      debts: number;
      initial: bigint;
      paid: bigint;
      returned: bigint;
      balance: bigint;
      overdue: bigint;
      firstIssuedDate: string;
      nearestDueDate: string | null;
    }
  >();
  for (const debt of debts) {
    const key = `${debt.kind}:${debt.counterpartyId ?? debt.counterparty.toLowerCase()}`;
    const balance = moneyCents(debt.balance);
    const group = groups.get(key) ?? {
      counterparty: debt.counterparty,
      counterpartyId: debt.counterpartyId,
      kind: debt.kind,
      debts: 0,
      initial: 0n,
      paid: 0n,
      returned: 0n,
      balance: 0n,
      overdue: 0n,
      firstIssuedDate: debt.issuedDate,
      nearestDueDate: null,
    };
    group.debts += 1;
    group.initial += moneyCents(debt.initialAmount);
    group.paid += moneyCents(debt.paidAmount);
    group.returned += moneyCents(debt.returnedAmount);
    group.balance += balance;
    if (debt.state === "overdue") group.overdue += balance;
    if (debt.issuedDate < group.firstIssuedDate) group.firstIssuedDate = debt.issuedDate;
    if (
      balance > 0n &&
      (group.nearestDueDate == null || debt.dueDate < group.nearestDueDate)
    ) {
      group.nearestDueDate = debt.dueDate;
    }
    groups.set(key, group);
  }
  const rows = [...groups.values()]
    .sort((left, right) => (left.balance > right.balance ? -1 : left.balance < right.balance ? 1 : 0))
    .map((group) => ({
      counterparty: group.counterparty,
      counterpartyId: group.counterpartyId,
      kind: group.kind,
      debts: group.debts,
      initialAmount: centsMoney(group.initial),
      paidAmount: centsMoney(group.paid),
      returnedAmount: centsMoney(group.returned),
      balance: centsMoney(group.balance),
      overdueAmount: centsMoney(group.overdue),
      firstIssuedDate: group.firstIssuedDate,
      nearestDueDate: group.nearestDueDate,
    }));
  res.json(ListCounterpartyBalancesResponse.parse(rows));
});

export default router;
