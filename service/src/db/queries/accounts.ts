import { eq } from "drizzle-orm";
import { db, type Executor } from "../index.js";
import { accounts, plans } from "../schema.js";

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export async function createAccount(values: NewAccount): Promise<Account> {
  const [account] = await db.insert(accounts).values(values).returning();
  return account;
}

export async function getAccountByKeyHash(apiKeyHash: string): Promise<Account | undefined> {
  const [account] = await db.select().from(accounts).where(eq(accounts.apiKeyHash, apiKeyHash));
  return account;
}

export async function getAccountPlan(tx: Executor, accountId: string) {
  const [row] = await tx
    .select({ plan: plans })
    .from(accounts)
    .innerJoin(plans, eq(plans.id, accounts.planId))
    .where(eq(accounts.id, accountId));
  return row.plan;
}

export async function updateAccountPlan(accountId: string, planId: string): Promise<Account> {
  const [account] = await db.update(accounts).set({ planId }).where(eq(accounts.id, accountId)).returning();
  return account;
}