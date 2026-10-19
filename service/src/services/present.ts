import type { Plan } from "../db/queries/plans.js";

export function presentPlan(plan: Plan) {
  return {
    id: plan.id,
    name: plan.name,
    scope: plan.scope,
    predefined: plan.accountId === null,
    monthlyAllowance: plan.monthlyAllowance,
    maxUnitsPerRequest: plan.maxUnitsPerRequest,
    updatedAt: plan.updatedAt,
  };
}