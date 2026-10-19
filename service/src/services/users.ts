import { getUserByExternalId, insertUser, updateUserPlan, type User } from "../db/queries/users.js";
import { isUniqueViolation } from "../db/index.js";
import { DEFAULT_USER_PLAN_ID } from "../constants.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { getAssignablePlan } from "./plans.js";

export async function registerUser(accountId: string, externalId: string, planId: string = DEFAULT_USER_PLAN_ID): Promise<User> {
  await getAssignablePlan(accountId, planId, "user");
  try {
    return await insertUser({ accountId, externalId, planId });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`User "${externalId}" already exists`, "user_exists");
    }
    throw err;
  }
}

export async function getUserOr404(accountId: string, externalId: string): Promise<User> {
  const user = await getUserByExternalId(accountId, externalId);
  if (!user) {
    throw new NotFoundError(`User "${externalId}" not found`);
  }
  return user;
}

export async function changeUserPlan(accountId: string, externalId: string, planId: string): Promise<User> {
  const user = await getUserOr404(accountId, externalId);
  await getAssignablePlan(accountId, planId, "user");
  return updateUserPlan(user.id, planId);
}