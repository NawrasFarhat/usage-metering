import { Router } from "express";
import { getAccount } from "../middleware/auth.js";
import { createCustomPlan, getPlanOr404, listPlans, updateCustomPlan } from "../services/plans.js";
import { presentPlan } from "../services/present.js";
import { BadRequestError } from "../errors.js";
import { optionalInt, optionalString, requireInt, requireObject, requireString } from "../validation.js";

export const plansRouter = Router();

plansRouter.get("/plans", async (req, res) => {
  const plans = await listPlans(getAccount(req).id);
  res.json({ items: plans.map(presentPlan) });
});

plansRouter.get("/plans/:planId", async (req, res) => {
  const plan = await getPlanOr404(getAccount(req).id, req.params.planId);
  res.json(presentPlan(plan));
});

plansRouter.post("/plans", async (req, res) => {
  const body = requireObject(req.body);
  const scope = body.scope;
  if (scope !== "account" && scope !== "user") {
    throw new BadRequestError('scope must be "account" or "user"');
  }
  const plan = await createCustomPlan(getAccount(req).id, {
    name: requireString(body, "name", 100),
    scope,
    monthlyAllowance: requireInt(body, "monthlyAllowance", 0),
    maxUnitsPerRequest: requireInt(body, "maxUnitsPerRequest", 1),
  });
  res.status(201).json(presentPlan(plan));
});

plansRouter.patch("/plans/:planId", async (req, res) => {
  const body = requireObject(req.body);
  if (body.scope !== undefined) {
    throw new BadRequestError("scope cannot be changed after a plan is created");
  }
  const changes: { name?: string; monthlyAllowance?: number; maxUnitsPerRequest?: number } = {};
  const name = optionalString(body, "name", 100);
  const monthlyAllowance = optionalInt(body, "monthlyAllowance", 0);
  const maxUnitsPerRequest = optionalInt(body, "maxUnitsPerRequest", 1);
  if (name !== undefined) changes.name = name;
  if (monthlyAllowance !== undefined) changes.monthlyAllowance = monthlyAllowance;
  if (maxUnitsPerRequest !== undefined) changes.maxUnitsPerRequest = maxUnitsPerRequest;

  const plan = await updateCustomPlan(getAccount(req).id, req.params.planId, changes);
  res.json(presentPlan(plan));
});