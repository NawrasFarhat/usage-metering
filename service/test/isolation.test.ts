import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, stopServer, call, createAccount, createUser, createUserPlan, consume } from "./helpers.js";
import { closeDb } from "../src/db/index.js";

beforeAll(startServer);
afterAll(async () => { await stopServer(); await closeDb(); });

describe("account isolation", () => {
  it("the same user id in two accounts is two different users", async () => {
    const a = await createAccount();
    const b = await createAccount();
    expect((await createUser(a.key, "ahmed")).status).toBe(201);
    expect((await createUser(b.key, "ahmed")).status).toBe(201);

    await consume(a.key, "ahmed", 10);
    const inB = await call("GET", "/v1/users/ahmed", { key: b.key });
    expect(inB.body.used).toBe(0);
  });

  it("an account cannot consume for another account's user (404, not 403)", async () => {
    const a = await createAccount();
    const b = await createAccount();
    await createUser(a.key, "only-in-a");

    const res = await consume(b.key, "only-in-a", 1);
    expect(res.status).toBe(404);
    const missing = await consume(b.key, "does-not-exist", 1);
    expect(missing.status).toBe(404);
    expect(res.body.error.code).toBe(missing.body.error.code);
  });

  it("an account cannot see, use or edit another account's custom plan", async () => {
    const a = await createAccount();
    const b = await createAccount();
    const planOfA = await createUserPlan(a.key, 500, 50);

    expect((await call("GET", `/v1/plans/${planOfA}`, { key: b.key })).status).toBe(404);
    expect((await createUser(b.key, "u", planOfA)).status).toBe(404);
    expect((await call("PATCH", `/v1/plans/${planOfA}`, { key: b.key, body: { monthlyAllowance: 1 } })).status).toBe(404);

    const listB = await call("GET", "/v1/plans", { key: b.key });
    expect(listB.body.items.map((p: { id: string }) => p.id)).not.toContain(planOfA);
  });

  it("request ids are scoped per account", async () => {
    const a = await createAccount();
    const b = await createAccount();
    await createUser(a.key, "u");
    await createUser(b.key, "u");

    const first = await consume(a.key, "u", 5, "same-id");
    const second = await consume(b.key, "u", 7, "same-id");
    expect(first.body.accepted).toBe(true);
    expect(second.body.accepted).toBe(true);
    expect(second.body.replayed).toBe(false);
  });

  it("history and usage only show the caller's data", async () => {
    const a = await createAccount();
    const b = await createAccount();
    await createUser(a.key, "u");
    await consume(a.key, "u", 3);

    const history = await call("GET", "/v1/requests", { key: b.key });
    expect(history.body.items).toHaveLength(0);
    const usage = await call("GET", "/v1/usage", { key: b.key });
    expect(usage.body.account.used).toBe(0);
  });
});