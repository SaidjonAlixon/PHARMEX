import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/** Tenant / company workspace. */
export const organizationsTable = pgTable(
  "pharmacy_organizations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ownerUserId: integer("owner_user_id"),
    // starter | business | enterprise
    planCode: text("plan_code").notNull().default("starter"),
    // trialing | active | past_due | canceled
    subscriptionStatus: text("subscription_status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
    // null = unlimited (enterprise)
    branchLimit: integer("branch_limit"),
    telegramChatId: text("telegram_chat_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("pharmacy_organizations_slug_idx").on(table.slug),
    index("pharmacy_organizations_status_idx").on(table.subscriptionStatus),
  ],
);

export const paymentsTable = pgTable(
  "pharmacy_payments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    planCode: text("plan_code").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("UZS"),
    // pending | prepared | paid | failed | canceled
    status: text("status").notNull().default("pending"),
    merchantTransId: text("merchant_trans_id").notNull(),
    prepareId: integer("prepare_id"),
    clickTransId: text("click_trans_id"),
    clickPaydocId: text("click_paydoc_id"),
    errorNote: text("error_note").notNull().default(""),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("pharmacy_payments_merchant_trans_idx").on(table.merchantTransId),
    index("pharmacy_payments_org_idx").on(table.organizationId),
    index("pharmacy_payments_click_trans_idx").on(table.clickTransId),
  ],
);

export const insertOrganizationSchema = createInsertSchema(organizationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Organization = typeof organizationsTable.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
