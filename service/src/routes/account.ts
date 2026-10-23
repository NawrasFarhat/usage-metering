import { Router } from "express";
import { getAccount } from "../middleware/auth.js";
import { getPlanById } from "../db/queries/plans.js";
import { changeAccountPlan } from "../services/accounts.js";
import { presentPlan } from "../services/present.js";
import { requireObject, requireUuid } from "../validation.js";

export const accountRouter = Router();



accountRouter.get("/account", async (req, res) => {
  const account = getAccount(req);
  const plan = await getPlanById(account.planId);

  res.json({
    id: account.id,
    name: account.name,
    plan: presentPlan(plan!),
    createdAt: account.createdAt,
  });
});

accountRouter.put("/account/plan", async (req, res) => {
  const body = requireObject(req.body);
  const planId = requireUuid(body, "planId");
  const account = await changeAccountPlan(getAccount(req), planId);
  const plan = (await getPlanById(account.planId))!;
  res.json({ id: account.id, name: account.name, plan: presentPlan(plan) });
});
