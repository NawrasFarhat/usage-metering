import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { hashApiKey, safeEqual } from "../auth/apiKeys.js";
import { getAccountByKeyHash, type Account } from "../db/queries/accounts.js";
import { UnauthorizedError } from "../errors.js";


declare global {
  namespace Express {
    interface Request {
      account?: Account;
    }
  }
}


export async function requireAccount(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.get("X-API-Key");
  if (!apiKey) {
    throw new UnauthorizedError();
  }

  const account = await getAccountByKeyHash(hashApiKey(apiKey));
  if (!account) {
    throw new UnauthorizedError();
  }

  req.account = account;
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const adminKey = req.get("X-Admin-Key");
  if (!adminKey || !safeEqual(adminKey, config.adminApiKey)) {
    throw new UnauthorizedError("Missing or invalid admin key");
  }
  next();
}


export function getAccount(req: Request): Account {
  if (!req.account) {
    throw new UnauthorizedError();
  }
  return req.account;
}