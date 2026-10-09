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
import { branchesTable, productsTable } from "./core";

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
    paymentType: text("payment_type").notNull().default("cash"),
    status: text("status").notNull().default("completed"),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
  },
  (table) => [
    index("pharmacy_sales_date_idx").on(table.soldAt),
    index("pharmacy_sales_branch_idx").on(table.branchId),
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
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 16, scale: 2 }).notNull(),
    discount: numeric("discount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    costPrice: numeric("cost_price", { precision: 16, scale: 2 }),
  },
  (table) => [
    index("pharmacy_sale_items_sale_idx").on(table.saleId),
    index("pharmacy_sale_items_product_idx").on(table.productId),
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
    movementType: text("movement_type").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 16, scale: 2 }),
    documentNo: text("document_no").notNull().default(""),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
  },
  (table) => [
    index("pharmacy_inventory_movements_date_idx").on(table.occurredAt),
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
export type InventoryBalance = typeof inventoryBalancesTable.$inferSelect;
export type InventoryMovement = typeof inventoryMovementsTable.$inferSelect;
