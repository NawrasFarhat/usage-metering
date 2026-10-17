import { sql } from "drizzle-orm";
import {pgTable, uuid, text, integer, timestamp, unique, check,} from "drizzle-orm/pg-core";

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
 
    accountId: uuid("account_id"),
    name: text("name").notNull(),
    scope: text("scope", { enum: ["account", "user"] }).notNull(),
    monthlyAllowance: integer("monthly_allowance").notNull(),
    maxUnitsPerRequest: integer("max_units_per_request").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("plans_account_name_unique").on(t.accountId, t.name).nullsNotDistinct(),
    check("plans_scope_check", sql`${t.scope} IN ('account', 'user')`),
    check("plans_monthly_allowance_check", sql`${t.monthlyAllowance} >= 0`),
    check("plans_max_units_check", sql`${t.maxUnitsPerRequest} >= 1`),
  ],
);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // SHA-256 of the API key. UNIQUE also creates the index used by auth.
  apiKeyHash: text("api_key_hash").notNull().unique(),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    externalId: text("external_id").notNull(),
    planId: uuid("plan_id").notNull().references(() => plans.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The same "ahmed" can exist in two different accounts
    unique("users_account_external_unique").on(t.accountId, t.externalId),
  ],
);