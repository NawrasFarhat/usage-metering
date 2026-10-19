import { generateApiKey, hashApiKey } from "../auth/apiKeys.js";
import { createAccount, type Account } from "../db/queries/accounts.js";
import { getPlanById } from "../db/queries/plans.js";
import { DEFAULT_ACCOUNT_PLAN_ID } from "../constants.js";
import { BadRequestError } from "../errors.js";

export async function createAccountWithKey(
  name: string,
  planId: string = DEFAULT_ACCOUNT_PLAN_ID,
): Promise<{ account: Account; apiKey: string }> {
  const plan = await getPlanById(planId);
  if (!plan || plan.accountId !== null || plan.scope !== "account") {
    throw new BadRequestError("planId must be a predefined account plan", "invalid_plan");
  }

  const apiKey = generateApiKey();
  const account = await createAccount({ name, planId, apiKeyHash: hashApiKey(apiKey) });
  return { account, apiKey };
}