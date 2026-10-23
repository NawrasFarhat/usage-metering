import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { startServer, stopServer, call, createAccount, createUser, createUserPlan, consume } from "./helpers.js";
import { closeDb, db } from "../src/db/index.js";

beforeAll(startServer);
afterAll(async () => { await stopServer(); await closeDb(); });

describe("competing requests", () => {
  it("never consumes more than the account allowance under concurrent requests", async () => {
    const { key, id } = await createAccount({ monthlyAllowance: 100, maxUnitsPerRequest: 100 });
    const userPlan = await createUserPlan(key, 1_000, 100);
    const userIds = ["u1", "u2", "u3"];
    for (const u of userIds) await createUser(key, u, userPlan);

    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => consume(key, userIds[i % 3], 5)),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    const accepted = results.filter((r) => r.body.accepted).length;
    expect(accepted).toBe(20); 

    const usage = await call("GET", "/v1/usage", { key });
    const sumUsers = usage.body.users.reduce((s: number, u: { used: number }) => s + u.used, 0);
    expect(usage.body.account.used).toBe(100);
    expect(sumUsers).toBe(100);

    const rows = await db.execute<{ total: string }>(
      sql`select coalesce(sum(units), 0) as total from consume_requests where account_id = ${id} and accepted`,
    );
    expect(Number(rows[0].total)).toBe(100);
  });

  it("the same requestId sent many times at once is consumed exactly once", async () => {
    const { key } = await createAccount();
    await createUser(key, "u");

    const results = await Promise.all(Array.from({ length: 20 }, () => consume(key, "u", 10, "burst")));

    expect(results.every((r) => r.status === 200 && r.body.accepted)).toBe(true);
    expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
    expect((await call("GET", "/v1/users/u", { key })).body.used).toBe(10);
  });

  it("a user's individual limit holds under concurrency too", async () => {
    const { key } = await createAccount();
    const plan = await createUserPlan(key, 30, 10);
    await createUser(key, "u", plan);

    const results = await Promise.all(Array.from({ length: 20 }, () => consume(key, "u", 3)));
    expect(results.filter((r) => r.body.accepted)).toHaveLength(10); 
    expect((await call("GET", "/v1/users/u", { key })).body.used).toBe(30);
  });
});