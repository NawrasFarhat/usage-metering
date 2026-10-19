import { Router } from "express";
import { getAccount } from "../middleware/auth.js";
import { getPlanById } from "../db/queries/plans.js";

export const accountRouter = Router();



accountRouter.get("/account", async (req, res) => {
  const account = getAccount(req);
  const plan = await getPlanById(account.planId);

  res.json({
    id: account.id,
    name: account.name,
    plan,
    createdAt: account.createdAt,
  });
});