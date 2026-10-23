import type { Account } from "../db/queries/accounts.js";
import { getAccountById } from "../db/queries/accounts.js";
import { getPlanById } from "../db/queries/plans.js";
import type { User } from "../db/queries/users.js";
import {getAccountUsed, getUserUsed, listAccountMonths, listUserMonths, listUsersWithUsage,} from "../db/queries/usage.js";
import { listRequests } from "../db/queries/requests.js";
import { remaining } from "../rules/rules.js";
import { currentMonth, formatMonth } from "../month.js";
import { db } from "../db/index.js";
import { presentPlan } from "./present.js";
import { present } from "./consume.js";

function summary(plan: { monthlyAllowance: number; maxUnitsPerRequest: number }, used: number, isCurrent: boolean) {
  return {
    used,
    monthlyAllowance: isCurrent ? plan.monthlyAllowance : null,
    remaining: isCurrent ? remaining({ limits: plan, used }) : null,
  };
}

export async function accountUsage(account: Account, month: string | undefined, page: { limit: number; offset: number }) {
  const now = await currentMonth(db);
  const target = month ?? now;
  const isCurrent = target === now;

  const fresh = (await getAccountById(account.id))!;
  const accountPlan = (await getPlanById(fresh.planId))!;
  const used = await getAccountUsed(account.id, target);
  const rows = await listUsersWithUsage(account.id, target, page.limit, page.offset);

  const plansById = new Map<string, Awaited<ReturnType<typeof getPlanById>>>();
  for (const r of rows) {
    if (!plansById.has(r.planId)) plansById.set(r.planId, await getPlanById(r.planId));
  }

  return {
    month: formatMonth(target),
    current: isCurrent,
    account: { plan: presentPlan(accountPlan), ...summary(accountPlan, used, isCurrent) },
    users: rows.map((r) => {
      const plan = plansById.get(r.planId)!;
      return { userId: r.externalId, plan: { id: plan.id, name: plan.name }, ...summary(plan, r.used, isCurrent) };
    }),
    limit: page.limit,
    offset: page.offset,
  };
}

export async function userUsage(user: User, month: string | undefined) {
  const now = await currentMonth(db);
  const target = month ?? now;
  const isCurrent = target === now;
  const plan = (await getPlanById(user.planId))!;
  const used = await getUserUsed(user.id, target);
  return {
    userId: user.externalId,
    month: formatMonth(target),
    current: isCurrent,
    plan: presentPlan(plan),
    ...summary(plan, used, isCurrent),
  };
}

export async function accountMonths(accountId: string) {
  const rows = await listAccountMonths(accountId);
  return rows.map((r) => ({ month: formatMonth(r.month), used: r.used }));
}

export async function userMonths(userId: string) {
  const rows = await listUserMonths(userId);
  return rows.map((r) => ({ month: formatMonth(r.month), used: r.used }));
}

export async function requestHistory(
  accountId: string,
  filters: { userId?: string; month?: string },
  page: { limit: number; offset: number },
) {
  const rows = await listRequests(accountId, filters, page.limit, page.offset);
  return { items: rows.map((r) => present(r, false)), limit: page.limit, offset: page.offset };
}