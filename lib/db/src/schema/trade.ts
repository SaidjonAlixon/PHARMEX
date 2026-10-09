import { createInsertSchema } from "drizzle-zod";
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { branchesTable, counterpartiesTable, productsTable } from "./core";

export const salesTable = pgTable(
  "pharmacy_sales",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branchesTable.id),
    receiptNo: text("receipt_no").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    cashier: text("cashier").notNull().default(""),
    customerName: text("customer_name").notNull().default(""),
    kind: text("kind").notNull().default("sale"),
    originalSaleId: integer("original_sale_id"),
    paymentType: text("payment_type").notNull().default("cash"),
    status: text("status").notNull().default("completed"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason").notNull().default(""),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull().default(""),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
  },
  (table) => [
    index("pharmacy_sales_date_idx").on(table.soldAt),
    index("pharmacy_sales_branch_idx").on(table.branchId),
    index("pharmacy_sales_original_idx").on(table.originalSaleId),
    uniqueIndex("pharmacy_sales_source_id_idx").on(
      table.source,
      table.sourceId,
    ),
  ],
);

export const saleItemsTable = pgTable(
  "pharmacy_sale_items",
  {
    id: serial("id").primaryKey(),
    saleId: integer("sale_id")
      .notNull()
      .references(() => salesTable.id),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    originalItemId: integer("original_item_id"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 16, scale: 2 }).notNull(),
    discount: numeric("discount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    costPrice: numeric("cost_price", { precision: 16, scale: 2 }),
  },
  (table) => [
    index("pharmacy_sale_items_sale_idx").on(table.saleId),
    index("pharmacy_sale_items_product_idx").on(table.productId),
  ],
);

export const salePaymentsTable = pgTable(
  "pharmacy_sale_payments",
  {
    id: serial("id").primaryKey(),
    saleId: integer("sale_id")
      .notNull()
      .references(() => salesTable.id),
    method: text("method").notNull(),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    accountId: integer("account_id"),
    debtId: integer("debt_id"),
  },
  (table) => [index("pharmacy_sale_payments_sale_idx").on(table.saleId)],
);

export const purchasesTable = pgTable(
  "pharmacy_purchases",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branchesTable.id),
    counterpartyId: integer("counterparty_id").references(
      () => counterpartiesTable.id,
    ),
    supplierName: text("supplier_name").notNull(),
    documentNo: text("document_no").notNull().default(""),
    invoiceNo: text("invoice_no").notNull().default(""),
    eInvoiceId: text("e_invoice_id").notNull().default(""),
    invoiceDate: date("invoice_date", { mode: "string" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    itemsTotal: numeric("items_total", { precision: 16, scale: 2 }).notNull(),
    discount: numeric("discount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    extraCosts: numeric("extra_costs", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    extraCostsNote: text("extra_costs_note").notNull().default(""),
    vatAmount: numeric("vat_amount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    totalAmount: numeric("total_amount", { precision: 16, scale: 2 }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    debtId: integer("debt_id"),
    status: text("status").notNull().default("posted"),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull().default(""),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pharmacy_purchases_date_idx").on(table.receivedAt),
    index("pharmacy_purchases_branch_idx").on(table.branchId),
    uniqueIndex("pharmacy_purchases_source_id_idx").on(
      table.source,
      table.sourceId,
    ),
  ],
);

export const purchaseItemsTable = pgTable(
  "pharmacy_purchase_items",
  {
    id: serial("id").primaryKey(),
    purchaseId: integer("purchase_id")
      .notNull()
      .references(() => purchasesTable.id),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 16, scale: 2 }).notNull(),
    discount: numeric("discount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    landedUnitCost: numeric("landed_unit_cost", {
      precision: 16,
      scale: 2,
    }).notNull(),
    expiryDate: date("expiry_date", { mode: "string" }),
  },
  (table) => [index("pharmacy_purchase_items_purchase_idx").on(table.purchaseId)],
);

export const stockDocumentsTable = pgTable(
  "pharmacy_stock_documents",
  {
    id: serial("id").primaryKey(),
    docType: text("doc_type").notNull(),
    documentNo: text("document_no").notNull().default(""),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branchesTable.id),
    toBranchId: integer("to_branch_id").references(() => branchesTable.id),
    counterpartyId: integer("counterparty_id").references(
      () => counterpartiesTable.id,
    ),
    counterpartyName: text("counterparty_name").notNull().default(""),
    purchaseId: integer("purchase_id"),
    saleId: integer("sale_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull().default(""),
    note: text("note").notNull().default(""),
    totalCost: numeric("total_cost", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    status: text("status").notNull().default("posted"),
    createdBy: text("created_by").notNull().default(""),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pharmacy_stock_documents_date_idx").on(table.occurredAt),
    index("pharmacy_stock_documents_type_idx").on(table.docType),
    uniqueIndex("pharmacy_stock_documents_source_id_idx").on(
      table.source,
      table.sourceId,
    ),
  ],
);

export const inventoryBalancesTable = pgTable(
  "pharmacy_inventory_balances",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branchesTable.id),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    quantity: numeric("quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    costPrice: numeric("cost_price", { precision: 16, scale: 2 }),
    source: text("source").notNull().default("manual"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("pharmacy_inventory_branch_product_idx").on(
      table.branchId,
      table.productId,
    ),
  ],
);

export const inventoryMovementsTable = pgTable(
  "pharmacy_inventory_movements",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branchesTable.id),
    toBranchId: integer("to_branch_id").references(() => branchesTable.id),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    documentId: integer("document_id").references(() => stockDocumentsTable.id),
    movementType: text("movement_type").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    expectedQuantity: numeric("expected_quantity", { precision: 14, scale: 3 }),
    countedQuantity: numeric("counted_quantity", { precision: 14, scale: 3 }),
    unitCost: numeric("unit_cost", { precision: 16, scale: 2 }),
    documentNo: text("document_no").notNull().default(""),
    note: text("note").notNull().default(""),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
  },
  (table) => [
    index("pharmacy_inventory_movements_date_idx").on(table.occurredAt),
    index("pharmacy_inventory_movements_document_idx").on(table.documentId),
    uniqueIndex("pharmacy_inventory_movements_source_id_idx").on(
      table.source,
      table.sourceId,
    ),
  ],
);

export const insertSaleSchema = createInsertSchema(salesTable).omit({
  id: true,
});
export const insertSaleItemSchema = createInsertSchema(saleItemsTable).omit({
  id: true,
});
export const insertInventoryBalanceSchema = createInsertSchema(
  inventoryBalancesTable,
).omit({ id: true, updatedAt: true });
export const insertInventoryMovementSchema = createInsertSchema(
  inventoryMovementsTable,
).omit({ id: true });

export type InsertSale = z.infer<typeof insertSaleSchema>;
export type Sale = typeof salesTable.$inferSelect;
export type InsertSaleItem = z.infer<typeof insertSaleItemSchema>;
export type SaleItem = typeof saleItemsTable.$inferSelect;
export type SalePayment = typeof salePaymentsTable.$inferSelect;
export type Purchase = typeof purchasesTable.$inferSelect;
export type PurchaseItem = typeof purchaseItemsTable.$inferSelect;
export type StockDocument = typeof stockDocumentsTable.$inferSelect;
export type InventoryBalance = typeof inventoryBalancesTable.$inferSelect;
export type InventoryMovement = typeof inventoryMovementsTable.$inferSelect;
