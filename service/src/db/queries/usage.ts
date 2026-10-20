import { and, desc, eq, sql } from "drizzle-orm";
import { db, type Executor, type Tx } from "../index.js";
import { accountUsage, userUsage, users } from "../schema.js";


export async function lockAccountUsage(tx: Tx, accountId: string, month: string): Promise<number> {
  const [row] = await tx
    .insert(accountUsage)
    .values({ accountId, month, used: 0 })
    .onConflictDoUpdate({
      target: [accountUsage.accountId, accountUsage.month],
      set: { used: sql`${accountUsage.used}` },
    })
    .returning({ used: accountUsage.used });
  return row.used;
}

export async function lockUserUsage(tx: Tx, userId: string, month: string): Promise<number> {
  const [row] = await tx
    .insert(userUsage)
    .values({ userId, month, used: 0 })
    .onConflictDoUpdate({
      target: [userUsage.userId, userUsage.month],
      set: { used: sql`${userUsage.used}` },
    })
    .returning({ used: userUsage.used });
  return row.used;
}

export async function incrementUsage(tx: Tx, accountId: string, userId: string, month: string, units: number) {
  await tx.execute(sql`
    with account_row as (
      update account_usage set used = used + ${units}
      where account_id = ${accountId} and month = ${month}
    )
    update user_usage set used = used + ${units}
    where user_id = ${userId} and month = ${month}
  `);
}

// Reads (no locks). A missing row simply means nothing was used that month.
export async function getAccountUsed(accountId: string, month: string, exec: Executor = db): Promise<number> {
  const [row] = await exec
    .select({ used: accountUsage.used })
    .from(accountUsage)
    .where(and(eq(accountUsage.accountId, accountId), eq(accountUsage.month, month)));
  return row?.used ?? 0;
}

export async function getUserUsed(userId: string, month: string, exec: Executor = db): Promise<number> {
  const [row] = await exec
    .select({ used: userUsage.used })
    .from(userUsage)
    .where(and(eq(userUsage.userId, userId), eq(userUsage.month, month)));
  return row?.used ?? 0;
}

export async function listAccountMonths(accountId: string) {
  return db
    .select({ month: accountUsage.month, used: accountUsage.used })
    .from(accountUsage)
    .where(eq(accountUsage.accountId, accountId))
    .orderBy(desc(accountUsage.month));
}

export async function listUserMonths(userId: string) {
  return db
    .select({ month: userUsage.month, used: userUsage.used })
    .from(userUsage)
    .where(eq(userUsage.userId, userId))
    .orderBy(desc(userUsage.month));
}

export async function listUsersWithUsage(accountId: string, month: string, limit: number, offset: number) {
  return db
    .select({
      externalId: users.externalId,
      planId: users.planId,
      used: sql<number>`coalesce(${userUsage.used}, 0)`.mapWith(Number),
    })
    .from(users)
    .leftJoin(userUsage, and(eq(userUsage.userId, users.id), eq(userUsage.month, month)))
    .where(eq(users.accountId, accountId))
    .orderBy(users.externalId)
    .limit(limit)
    .offset(offset);
}