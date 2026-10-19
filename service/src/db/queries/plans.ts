import { eq } from "drizzle-orm";
import { db } from "../index.js";
import { plans } from "../schema.js";

export type Plan = typeof plans.$inferSelect;

export async function getPlanById(id: string): Promise<Plan | undefined> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, id));
  return plan;
}