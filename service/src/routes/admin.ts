import { Router } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { createAccountWithKey } from "../services/accounts.js";
import { requireObject, requireString, optionalUuid } from "../validation.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);


adminRouter.post("/accounts", async (req, res) => {
  const body = requireObject(req.body);
  const name = requireString(body, "name", 100);
  const planId = optionalUuid(body, "planId");

  const { account, apiKey } = await createAccountWithKey(name, planId);

  res.status(201).json({
    id: account.id,
    name: account.name,
    planId: account.planId,
    apiKey, 
    createdAt: account.createdAt,
  });
});