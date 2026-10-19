import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db, type Executor } from "../index.js";
import { plans } from "../schema.js";

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

export async function getPlanById(id: string, exec: Executor = db): Promise<Plan | undefined> {
  const [plan] = await exec.select().from(plans).where(eq(plans.id, id));
  return plan;
}

function visibleTo(accountId: string) {
  return or(isNull(plans.accountId), eq(plans.accountId, accountId));
}

export async function listVisiblePlans(accountId: string): Promise<Plan[]> {
  return db
    .select()
    .from(plans)
    .where(visibleTo(accountId))
    .orderBy(sql`${plans.accountId} nulls first`, asc(plans.scope), asc(plans.name));
}

export async function getVisiblePlan(accountId: string, planId: string): Promise<Plan | undefined> {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), visibleTo(accountId)));
  return plan;
}

export async function insertPlan(values: NewPlan): Promise<Plan> {
  const [plan] = await db.insert(plans).values(values).returning();
  return plan;
}

export async function updateOwnedPlan(
  accountId: string,
  planId: string,
  changes: Partial<Pick<Plan, "name" | "monthlyAllowance" | "maxUnitsPerRequest">>,
): Promise<Plan | undefined> {
  const [plan] = await db
    .update(plans)
    .set(changes)
    .where(and(eq(plans.id, planId), eq(plans.accountId, accountId)))
    .returning();
  return plan;
}