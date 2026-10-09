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

export const appUsersTable = pgTable(
  "pharmacy_app_users",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    displayName: text("display_name").notNull().default("Foydalanuvchi"),
    email: text("email").notNull().default(""),
    role: text("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("pharmacy_app_users_clerk_user_idx").on(table.clerkUserId),
    index("pharmacy_app_users_role_idx").on(table.role),
  ],
);

export const integrationSettingsTable = pgTable(
  "pharmacy_integration_settings",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("pharmacy_integration_settings_key_idx").on(table.key)],
);

export const integrationImportsTable = pgTable("pharmacy_integration_imports", {
  id: serial("id").primaryKey(),
  integration: text("integration").notNull().default("fom"),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  importedRecords: integer("imported_records").notNull().default(0),
  message: text("message").notNull().default(""),
});

export const auditLogTable = pgTable("pharmacy_audit_log", {
  id: serial("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  summary: text("summary").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertAppUserSchema = createInsertSchema(appUsersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type AppUser = typeof appUsersTable.$inferSelect;
export type InsertAppUser = z.infer<typeof insertAppUserSchema>;
export type IntegrationSetting = typeof integrationSettingsTable.$inferSelect;
export type IntegrationImport = typeof integrationImportsTable.$inferSelect;
export type AuditLogEntry = typeof auditLogTable.$inferSelect;
