import { Router } from "express";
import { getAccount } from "../middleware/auth.js";
import { accountMonths, accountUsage, requestHistory } from "../services/usage.js";
import { getUserOr404 } from "../services/users.js";
import { parseMonthParam } from "../month.js";
import { parsePagination } from "../validation.js";

export const usageRouter = Router();

usageRouter.get("/usage", async (req, res) => {
  const account = getAccount(req);
  res.json(await accountUsage(account, parseMonthParam(req.query.month), parsePagination(req.query)));
});

usageRouter.get("/usage/months", async (req, res) => {
  res.json({ items: await accountMonths(getAccount(req).id) });
});

usageRouter.get("/requests", async (req, res) => {
  const account = getAccount(req);
  const filters: { userId?: string; month?: string } = { month: parseMonthParam(req.query.month) };
  if (typeof req.query.userId === "string") {
    filters.userId = (await getUserOr404(account.id, req.query.userId)).id;
  }
  res.json(await requestHistory(account.id, filters, parsePagination(req.query)));
});