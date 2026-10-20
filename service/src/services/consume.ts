import { db, isUniqueViolation } from "../db/index.js";
import type { Account } from "../db/queries/accounts.js";
import { getAccountPlan } from "../db/queries/accounts.js";
import type { Plan } from "../db/queries/plans.js";
import { getUserWithPlanAndMonth } from "../db/queries/users.js";
import { incrementUsage, lockAccountUsage, lockUserUsage } from "../db/queries/usage.js";
import { findRequest, insertRequest, type StoredRequest } from "../db/queries/requests.js";
import { evaluate, describeRejection, remaining, type ScopeState, type Scope } from "../rules/rules.js";
import { formatMonth } from "../month.js";
import { ConflictError, NotFoundError } from "../errors.js";

export interface ConsumeInput {
  userId: string; 
  units: number;
  requestId: string;
}

interface LevelSnapshot {
  planId: string;
  planName: string;
  monthlyAllowance: number;
  maxUnitsPerRequest: number;
  usedBefore: number;
  usedAfter: number;
}

interface Snapshot {
  user: LevelSnapshot;
  account: LevelSnapshot;
}

export async function consume(account: Account, input: ConsumeInput) {
  const existing = await findRequest(account.id, input.requestId);
  if (existing) {
    return replay(existing, input);
  }

  try {
    return await db.transaction(async (tx) => {
      const found = await getUserWithPlanAndMonth(tx, account.id, input.userId);
      if (!found) {
        throw new NotFoundError(`User "${input.userId}" not found`);
      }
      const { user, plan: userPlan, month } = found;

      const accountUsed = await lockAccountUsage(tx, account.id, month);
      const userUsed = await lockUserUsage(tx, user.id, month);

      const accountPlan = await getAccountPlan(tx, account.id);

      const userState = toState(userPlan, userUsed);
      const accountState = toState(accountPlan, accountUsed);
      const decision = evaluate({ units: input.units, user: userState, account: accountState });

      const added = decision.accepted ? input.units : 0;
      if (decision.accepted) {
        await incrementUsage(tx, account.id, user.id, month, input.units);
      }

      const snapshot: Snapshot = {
        user: levelSnapshot(userPlan, userUsed, added),
        account: levelSnapshot(accountPlan, accountUsed, added),
      };

      const row = await insertRequest(tx, {
        accountId: account.id,
        userId: user.id,
        requestId: input.requestId,
        units: input.units,
        accepted: decision.accepted,
        rejectedScope: decision.accepted ? null : decision.scope,
        rejectedRule: decision.accepted ? null : decision.rule,
        month,
        snapshot,
      });

      return present({ ...row, externalUserId: user.externalId }, false);
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const stored = await findRequest(account.id, input.requestId);
      if (stored) {
        return replay(stored, input);
      }
    }
    throw err;
  }
}

function replay(stored: StoredRequest, input: ConsumeInput) {
  if (stored.externalUserId !== input.userId || stored.units !== input.units) {
    throw new ConflictError(
      `requestId "${input.requestId}" was already used with a different userId or units`,
      "idempotency_conflict",
    );
  }
  return present(stored, true);
}

function toState(plan: Plan, used: number): ScopeState {
  return { limits: { monthlyAllowance: plan.monthlyAllowance, maxUnitsPerRequest: plan.maxUnitsPerRequest }, used };
}

function levelSnapshot(plan: Plan, usedBefore: number, added: number): LevelSnapshot {
  return {
    planId: plan.id,
    planName: plan.name,
    monthlyAllowance: plan.monthlyAllowance,
    maxUnitsPerRequest: plan.maxUnitsPerRequest,
    usedBefore,
    usedAfter: usedBefore + added,
  };
}

export function present(row: StoredRequest, replayed: boolean) {
  const snapshot = row.snapshot as Snapshot;
  const level = (s: LevelSnapshot) => {
    const state = { limits: s, used: s.usedAfter };
    return {
      plan: { id: s.planId, name: s.planName },
      monthlyAllowance: s.monthlyAllowance,
      maxUnitsPerRequest: s.maxUnitsPerRequest,
      used: s.usedAfter,
      remaining: remaining(state),
    };
  };

  let rejection = null;
  if (!row.accepted && row.rejectedScope && row.rejectedRule) {
    const scope = row.rejectedScope as Scope;
    const s = snapshot[scope];
    rejection = {
      scope,
      rule: row.rejectedRule,
      message: describeRejection(scope, row.rejectedRule, row.units, { limits: s, used: s.usedBefore }),
    };
  }

  return {
    requestId: row.requestId,
    accepted: row.accepted,
    rejection,
    userId: row.externalUserId,
    units: row.units,
    month: formatMonth(row.month),
    user: level(snapshot.user),
    account: level(snapshot.account),
    replayed,
    processedAt: row.createdAt,
  };
}