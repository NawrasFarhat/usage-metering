import { eq } from "drizzle-orm";
import { db } from "../index.js";
import { accounts } from "../schema.js";

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