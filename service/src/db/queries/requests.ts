import { and, desc, eq } from "drizzle-orm";
import { db, type Executor, type Tx } from "../index.js";
import { consumeRequests, users } from "../schema.js";

export type ConsumeRequest = typeof consumeRequests.$inferSelect;
export type NewConsumeRequest = typeof consumeRequests.$inferInsert;
export type StoredRequest = ConsumeRequest & { externalUserId: string };

const selection = {
  request: consumeRequests,
  externalUserId: users.externalId,
};

function flatten(row: { request: ConsumeRequest; externalUserId: string }): StoredRequest {
  return { ...row.request, externalUserId: row.externalUserId };
}

export async function findRequest(
  accountId: string,
  requestId: string,
  exec: Executor = db,
): Promise<StoredRequest | undefined> {
  const [row] = await exec
    .select(selection)
    .from(consumeRequests)
    .innerJoin(users, eq(users.id, consumeRequests.userId))
    .where(and(eq(consumeRequests.accountId, accountId), eq(consumeRequests.requestId, requestId)));
  return row ? flatten(row) : undefined;
}

export async function insertRequest(tx: Tx, values: NewConsumeRequest): Promise<ConsumeRequest> {
  const [row] = await tx.insert(consumeRequests).values(values).returning();
  return row;
}

// History: newest first.
export async function listRequests(
  accountId: string,
  filters: { userId?: string; month?: string },
  limit: number,
  offset: number,
): Promise<StoredRequest[]> {
  const conditions = [eq(consumeRequests.accountId, accountId)];
  if (filters.userId) conditions.push(eq(consumeRequests.userId, filters.userId));
  if (filters.month) conditions.push(eq(consumeRequests.month, filters.month));

  const rows = await db
    .select(selection)
    .from(consumeRequests)
    .innerJoin(users, eq(users.id, consumeRequests.userId))
    .where(and(...conditions))
    .orderBy(desc(consumeRequests.createdAt), desc(consumeRequests.id))
    .limit(limit)
    .offset(offset);
  return rows.map(flatten);
}