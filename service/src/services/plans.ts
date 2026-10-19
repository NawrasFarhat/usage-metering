import {getVisiblePlan, insertPlan, listVisiblePlans, updateOwnedPlan, type Plan,} from "../db/queries/plans.js";
import { isUniqueViolation } from "../db/index.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import { isUuid } from "../validation.js";

export async function listPlans(accountId: string): Promise<Plan[]> {
  return listVisiblePlans(accountId);
}


export async function getPlanOr404(accountId: string, planId: string): Promise<Plan> {
  const plan = isUuid(planId) ? await getVisiblePlan(accountId, planId) : undefined;
  if (!plan) {
    throw new NotFoundError("Plan not found");
  }
  return plan;
}

export async function getAssignablePlan(accountId: string, planId: string, scope: "account" | "user"): Promise<Plan> {
  const plan = await getPlanOr404(accountId, planId);
  if (plan.scope !== scope) {
    throw new BadRequestError(`Plan "${plan.name}" is ${plan.scope === "account" ? "an account" : "a user"} plan and cannot be assigned to ${scope === "account" ? "an account" : "a user"}`, "invalid_plan_scope");
  }
  return plan;
}

export async function createCustomPlan(
  accountId: string,
  input: { name: string; scope: "account" | "user"; monthlyAllowance: number; maxUnitsPerRequest: number },
): Promise<Plan> {
  try {
    return await insertPlan({ ...input, accountId });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`A plan named "${input.name}" already exists`, "plan_name_taken");
    }
    throw err;
  }
}

export async function updateCustomPlan(
  accountId: string,
  planId: string,
  changes: { name?: string; monthlyAllowance?: number; maxUnitsPerRequest?: number },
): Promise<Plan> {
  const plan = await getPlanOr404(accountId, planId);
  if (plan.accountId === null) {
    throw new ForbiddenError("Predefined plans are read-only");
  }
  if (Object.keys(changes).length === 0) {
    return plan;
  }
  try {

    const updated = await updateOwnedPlan(accountId, planId, changes);
    if (!updated) {
      throw new NotFoundError("Plan not found");
    }
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`A plan named "${changes.name}" already exists`, "plan_name_taken");
    }
    throw err;
  }
}