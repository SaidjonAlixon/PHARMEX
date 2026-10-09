import { createInsertSchema } from "drizzle-zod";
import {
  date,
  index,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const branchesTable = pgTable(
  "pharmacy_branches",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    fomId: text("fom_id"),
    region: text("region").notNull().default(""),
    address: text("address").notNull().default(""),
    manager: text("manager").notNull().default(""),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("manual"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("pharmacy_branches_name_idx").on(table.name),
    uniqueIndex("pharmacy_branches_source_fom_id_idx").on(
      table.source,
      table.fomId,
    ),
  ],
);

export const productsTable = pgTable(
  "pharmacy_products",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    barcode: text("barcode"),
    fomId: text("fom_id"),
    groupName: text("group_name").notNull().default("Boshqa"),
    retailPrice: numeric("retail_price", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    costPrice: numeric("cost_price", { precision: 16, scale: 2 }),
    expiryDate: date("expiry_date", { mode: "string" }),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pharmacy_products_name_idx").on(table.name),
    uniqueIndex("pharmacy_products_barcode_idx").on(table.barcode),
    uniqueIndex("pharmacy_products_source_fom_id_idx").on(
      table.source,
      table.fomId,
    ),
  ],
);

export const insertBranchSchema = createInsertSchema(branchesTable).omit({
  id: true,
  updatedAt: true,
});
export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertBranch = z.infer<typeof insertBranchSchema>;
export type Branch = typeof branchesTable.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
