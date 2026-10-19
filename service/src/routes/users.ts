import { Router } from "express";
import { getAccount } from "../middleware/auth.js";
import { listUsers } from "../db/queries/users.js";
import { getPlanById } from "../db/queries/plans.js";
import { changeUserPlan, getUserOr404, registerUser } from "../services/users.js";
import { presentPlan } from "../services/present.js";
import { optionalUuid, parsePagination, requireObject, requireString, requireUuid } from "../validation.js";
import type { User } from "../db/queries/users.js";

export const usersRouter = Router();

async function presentUser(user: User) {
  const plan = (await getPlanById(user.planId))!;
  return { userId: user.externalId, plan: presentPlan(plan), createdAt: user.createdAt };
}

usersRouter.post("/users", async (req, res) => {
  const body = requireObject(req.body);
  const externalId = requireString(body, "userId", 200);
  const planId = optionalUuid(body, "planId");
  const user = await registerUser(getAccount(req).id, externalId, planId);
  res.status(201).json(await presentUser(user));
});

usersRouter.get("/users", async (req, res) => {
  const page = parsePagination(req.query);
  const users = await listUsers(getAccount(req).id, page.limit, page.offset);
  res.json({
    items: users.map((u) => ({ userId: u.externalId, planId: u.planId, createdAt: u.createdAt })),
    ...page,
  });
});

usersRouter.get("/users/:userId", async (req, res) => {
  const user = await getUserOr404(getAccount(req).id, req.params.userId);
  res.json(await presentUser(user));
});

usersRouter.put("/users/:userId/plan", async (req, res) => {
  const body = requireObject(req.body);
  const planId = requireUuid(body, "planId");
  const user = await changeUserPlan(getAccount(req).id, req.params.userId, planId);
  res.json(await presentUser(user));
});