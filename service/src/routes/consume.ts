import { Router } from "express";
import { getAccount } from "../middleware/auth.js";
import { consume } from "../services/consume.js";
import { requireInt, requireObject, requireString } from "../validation.js";

export const consumeRouter = Router();

consumeRouter.post("/consume", async (req, res) => {
  const body = requireObject(req.body);
  const result = await consume(getAccount(req), {
    userId: requireString(body, "userId", 200),
    units: requireInt(body, "units", 1),
    requestId: requireString(body, "requestId", 200),
  });
  res.json(result);
});