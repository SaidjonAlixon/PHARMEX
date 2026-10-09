import { createInsertSchema } from "drizzle-zod";
import {
  date,
  integer,
  index,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { branchesTable } from "./core";

export const expensesTable = pgTable(
  "pharmacy_expenses",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branchesTable.id),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    accountId: integer("account_id"),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
    status: text("status").notNull().default("confirmed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("pharmacy_expenses_source_id_idx").on(table.source, table.sourceId),
  ],
);

export const cashAccountsTable = pgTable(
  "pharmacy_cash_accounts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    branchId: integer("branch_id").references(() => branchesTable.id),
    openingBalance: numeric("opening_balance", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    source: text("source").notNull().default("manual"),
  },
  (table) => [
    uniqueIndex("pharmacy_cash_accounts_source_branch_name_idx").on(
      table.source,
      table.branchId,
      table.name,
    ),
  ],
);

export const moneyTransactionsTable = pgTable(
  "pharmacy_money_transactions",
  {
    id: serial("id").primaryKey(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    type: text("type").notNull(),
    category: text("category").notNull().default(""),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    direction: text("direction").notNull(),
    accountId: integer("account_id")
      .notNull()
      .references(() => cashAccountsTable.id),
    branchId: integer("branch_id").references(() => branchesTable.id),
    transferGroupId: text("transfer_group_id"),
    counterpartyName: text("counterparty_name").notNull().default(""),
    debtId: integer("debt_id"),
    saleId: integer("sale_id"),
    purchaseId: integer("purchase_id"),
    documentNo: text("document_no").notNull().default(""),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull().default(""),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
  },
  (table) => [
    index("pharmacy_money_transactions_date_idx").on(table.date),
    index("pharmacy_money_transactions_account_idx").on(table.accountId),
    uniqueIndex("pharmacy_money_transactions_source_id_idx").on(
      table.source,
      table.sourceId,
    ),
  ],
);

export const debtsTable = pgTable(
  "pharmacy_debts",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    counterparty: text("counterparty").notNull(),
    counterpartyId: integer("counterparty_id"),
    originType: text("origin_type").notNull().default("manual"),
    originId: integer("origin_id"),
    documentNo: text("document_no").notNull(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branchesTable.id),
    issuedDate: date("issued_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    initialAmount: numeric("initial_amount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    paidAmount: numeric("paid_amount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    returnedAmount: numeric("returned_amount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    status: text("status").notNull().default("active"),
    note: text("note").notNull().default(""),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pharmacy_debts_kind_idx").on(table.kind),
    uniqueIndex("pharmacy_debts_source_id_idx").on(table.source, table.sourceId),
  ],
);

export const debtPaymentsTable = pgTable(
  "pharmacy_debt_payments",
  {
    id: serial("id").primaryKey(),
    debtId: integer("debt_id")
      .notNull()
      .references(() => debtsTable.id),
    kind: text("kind").notNull().default("payment"),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    accountId: integer("account_id"),
    moneyTransactionId: integer("money_transaction_id"),
    stockDocumentId: integer("stock_document_id"),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull().default(""),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
  },
  (table) => [index("pharmacy_debt_payments_debt_idx").on(table.debtId)],
);

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  createdAt: true,
});
export const insertCashAccountSchema = createInsertSchema(
  cashAccountsTable,
).omit({ id: true });
export const insertMoneyTransactionSchema = createInsertSchema(
  moneyTransactionsTable,
).omit({ id: true });
export const insertDebtSchema = createInsertSchema(debtsTable).omit({
  id: true,
});
export const insertDebtPaymentSchema = createInsertSchema(
  debtPaymentsTable,
).omit({ id: true });

export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;
export type CashAccount = typeof cashAccountsTable.$inferSelect;
export type MoneyTransaction = typeof moneyTransactionsTable.$inferSelect;
export type Debt = typeof debtsTable.$inferSelect;
export type DebtPayment = typeof debtPaymentsTable.$inferSelect;
