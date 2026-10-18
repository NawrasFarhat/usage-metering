import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, boolean, date, jsonb, timestamp,
  unique, primaryKey, index, check, type AnyPgColumn,
} from "drizzle-orm/pg-core";


export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    accountId: uuid("account_id").references((): AnyPgColumn => accounts.id),
    name: text("name").notNull(),
    scope: text("scope", { enum: ["account", "user"] }).notNull(),
    monthlyAllowance: integer("monthly_allowance").notNull(),
    maxUnitsPerRequest: integer("max_units_per_request").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
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
    unique("users_account_external_unique").on(t.accountId, t.externalId),
  ],
);


export const accountUsage = pgTable(
  "account_usage",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    month: date("month", { mode: "string" }).notNull(), 
    used: integer("used").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.month] }),
    check("account_usage_used_check", sql`${t.used} >= 0`),
  ],
);

export const userUsage = pgTable(
  "user_usage",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    month: date("month", { mode: "string" }).notNull(),
    used: integer("used").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.month] }),
    check("user_usage_used_check", sql`${t.used} >= 0`),
  ],
);


export const consumeRequests = pgTable(
  "consume_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    requestId: text("request_id").notNull(),
    units: integer("units").notNull(),
    accepted: boolean("accepted").notNull(),
    rejectedScope: text("rejected_scope", { enum: ["account", "user"] }),
    rejectedRule: text("rejected_rule", {
      enum: ["monthly_allowance", "max_units_per_request"],
    }),
    month: date("month", { mode: "string" }).notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("consume_requests_account_request_unique").on(t.accountId, t.requestId),
    index("consume_requests_account_created_idx").on(t.accountId, t.createdAt.desc()),
    check("consume_requests_units_check", sql`${t.units} > 0`),
  ],
);