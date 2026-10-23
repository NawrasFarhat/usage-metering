import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, stopServer, call, createAccount, createUser, createUserPlan, consume, uniqueId } from "./helpers.js";
import { closeDb } from "../src/db/index.js";

beforeAll(startServer);
afterAll(async () => { await stopServer(); await closeDb(); });

async function briefSetup() {
  const { key } = await createAccount();
  await createUser(key, "ahmed");
  return key;
}

describe("consume: the brief's examples", () => {
  it("accepts 10 units and adds them to the user and the account", async () => {
    const key = await briefSetup();
    const res = await consume(key, "ahmed", 10);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.user).toMatchObject({ used: 10, remaining: 990 });
    expect(res.body.account).toMatchObject({ used: 10, remaining: 9_990 });
  });

  it("rejects 25 units by the user's per-request limit, and consumes nothing", async () => {
    const key = await briefSetup();
    const res = await consume(key, "ahmed", 25);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(false);
    expect(res.body.rejection).toMatchObject({ scope: "user", rule: "max_units_per_request" });
    expect(res.body.user.used).toBe(0);
    expect(res.body.account.used).toBe(0);
  });

  it("rejects when the account has only 5 units left, even if the user has plenty", async () => {
    const { key } = await createAccount({ monthlyAllowance: 15, maxUnitsPerRequest: 100 });
    await createUser(key, "first");
    await createUser(key, "second");
    expect((await consume(key, "first", 10)).body.accepted).toBe(true);

    const res = await consume(key, "second", 10);
    expect(res.body.accepted).toBe(false);
    expect(res.body.rejection).toMatchObject({ scope: "account", rule: "monthly_allowance" });
    expect(res.body.user.used).toBe(0);
  });
});

describe("consume: validation", () => {
  it.each([0, -5, 2.5, "10", null])("rejects units = %s with 400", async (units) => {
    const key = await briefSetup();
    const res = await call("POST", "/v1/consume", { key, body: { userId: "ahmed", units, requestId: uniqueId() } });
    expect(res.status).toBe(400);
  });

  it("requires a requestId", async () => {
    const key = await briefSetup();
    const res = await call("POST", "/v1/consume", { key, body: { userId: "ahmed", units: 1 } });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown user", async () => {
    const key = await briefSetup();
    expect((await consume(key, "ghost", 1)).status).toBe(404);
  });
});

describe("consume: safe retries", () => {
  it("a retry with the same requestId returns the stored result and consumes once", async () => {
    const key = await briefSetup();
    const first = await consume(key, "ahmed", 10, "retry-1");
    const again = await consume(key, "ahmed", 10, "retry-1");

    expect(again.body.replayed).toBe(true);
    expect({ ...again.body, replayed: false }).toEqual(first.body);
    const user = await call("GET", "/v1/users/ahmed", { key });
    expect(user.body.used).toBe(10);
  });

  it("a rejected request stays rejected when retried with the same requestId", async () => {
    const key = await briefSetup();
    await consume(key, "ahmed", 25, "too-big");
    const again = await consume(key, "ahmed", 25, "too-big");
    expect(again.body.accepted).toBe(false);
    expect(again.body.replayed).toBe(true);
  });

  it("the same requestId with different units is a 409 conflict", async () => {
    const key = await briefSetup();
    await consume(key, "ahmed", 10, "dup");
    const res = await consume(key, "ahmed", 11, "dup");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("idempotency_conflict");
  });
});

describe("plan changes", () => {
  it("reducing a monthly allowance below usage shows 0 remaining and rejects", async () => {
    const { key } = await createAccount();
    const planId = await createUserPlan(key, 1_000, 100);
    await createUser(key, "u", planId);
    await consume(key, "u", 70);

    await call("PATCH", `/v1/plans/${planId}`, { key, body: { monthlyAllowance: 50 } });

    const user = await call("GET", "/v1/users/u", { key });
    expect(user.body).toMatchObject({ used: 70, remaining: 0 });
    const res = await consume(key, "u", 1);
    expect(res.body.rejection).toMatchObject({ scope: "user", rule: "monthly_allowance" });
  });

  it("switching plans keeps the units already consumed", async () => {
    const { key } = await createAccount();
    const small = await createUserPlan(key, 100, 50);
    const big = await createUserPlan(key, 1_000, 50);
    await createUser(key, "u", small);
    await consume(key, "u", 40);

    const switched = await call("PUT", "/v1/users/u/plan", { key, body: { planId: big } });
    expect(switched.body).toMatchObject({ used: 40, remaining: 960 });
  });

  it("updating a shared plan affects every user on it, with separate totals", async () => {
    const { key } = await createAccount();
    const shared = await createUserPlan(key, 1_000, 10);
    await createUser(key, "a", shared);
    await createUser(key, "b", shared);
    expect((await consume(key, "a", 15)).body.accepted).toBe(false);

    await call("PATCH", `/v1/plans/${shared}`, { key, body: { maxUnitsPerRequest: 20 } });
    expect((await consume(key, "a", 15)).body.accepted).toBe(true);
    expect((await consume(key, "b", 15)).body.accepted).toBe(true);
    expect((await call("GET", "/v1/users/a", { key })).body.used).toBe(15);
    expect((await call("GET", "/v1/users/b", { key })).body.used).toBe(15);
  });

  it("history keeps the limits that applied at decision time", async () => {
    const { key } = await createAccount();
    const planId = await createUserPlan(key, 1_000, 100);
    await createUser(key, "u", planId);
    await consume(key, "u", 10, "before-change");
    await call("PATCH", `/v1/plans/${planId}`, { key, body: { monthlyAllowance: 5 } });

    const history = await call("GET", "/v1/requests", { key });
    const old = history.body.items.find((r: { requestId: string }) => r.requestId === "before-change");
    expect(old.user.monthlyAllowance).toBe(1_000);
    expect(old.accepted).toBe(true);
  });

  it("predefined plans are read-only", async () => {
    const { key } = await createAccount();
    const res = await call("PATCH", "/v1/plans/00000000-0000-0000-0000-000000000003", { key, body: { monthlyAllowance: 1 } });
    expect(res.status).toBe(403);
  });

  it("a user plan cannot be assigned to the account, and the reverse", async () => {
    const { key } = await createAccount();
    const userPlan = await createUserPlan(key, 100, 10);
    expect((await call("PUT", "/v1/account/plan", { key, body: { planId: userPlan } })).status).toBe(400);
    await createUser(key, "u");
    const res = await call("PUT", "/v1/users/u/plan", { key, body: { planId: "00000000-0000-0000-0000-000000000002" } });
    expect(res.status).toBe(400);
  });
});