import { and, asc, eq, sql } from "drizzle-orm";
import { db, type Executor } from "../index.js";
import { plans, users } from "../schema.js";

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export async function insertUser(values: NewUser): Promise<User> {
  const [user] = await db.insert(users).values(values).returning();
  return user;
}

export async function getUserByExternalId(
  accountId: string,
  externalId: string,
  exec: Executor = db,
): Promise<User | undefined> {
  const [user] = await exec
    .select()
    .from(users)
    .where(and(eq(users.accountId, accountId), eq(users.externalId, externalId)));
  return user;
}

export async function listUsers(accountId: string, limit: number, offset: number): Promise<User[]> {
  return db
    .select()
    .from(users)
    .where(eq(users.accountId, accountId))
    .orderBy(asc(users.externalId))
    .limit(limit)
    .offset(offset);
}

export async function updateUserPlan(userId: string, planId: string): Promise<User> {
  const [user] = await db.update(users).set({ planId }).where(eq(users.id, userId)).returning();
  return user;
}

export async function getUserWithPlanAndMonth(tx: Executor, accountId: string, externalId: string) {
  const [row] = await tx
    .select({
      user: users,
      plan: plans,
      month: sql<string>`to_char(date_trunc('month', now() at time zone 'utc'), 'YYYY-MM-DD')`,
    })
    .from(users)
    .innerJoin(plans, eq(plans.id, users.planId))
    .where(and(eq(users.accountId, accountId), eq(users.externalId, externalId)));
  return row;
}