import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, stopServer, call, createAccount, createUser, consume } from "./helpers.js";
import { closeDb, db } from "../src/db/index.js";
import { accountUsage, userUsage } from "../src/db/schema.js";
import { getUserByExternalId } from "../src/db/queries/users.js";

beforeAll(startServer);
afterAll(async () => { await stopServer(); await closeDb(); });

describe("usage and history", () => {
  it("records accepted and rejected requests, newest first, with pagination", async () => {
    const { key } = await createAccount();
    await createUser(key, "u");
    await consume(key, "u", 5, "h1");
    await consume(key, "u", 50, "h2"); 
    await consume(key, "u", 6, "h3");

    const page1 = await call("GET", "/v1/requests?limit=2", { key });
    expect(page1.body.items.map((r: { requestId: string }) => r.requestId)).toEqual(["h3", "h2"]);
    expect(page1.body.items[1].accepted).toBe(false);

    const page2 = await call("GET", "/v1/requests?limit=2&offset=2", { key });
    expect(page2.body.items.map((r: { requestId: string }) => r.requestId)).toEqual(["h1"]);
  });

  it("filters history by user", async () => {
    const { key } = await createAccount();
    await createUser(key, "a");
    await createUser(key, "b");
    await consume(key, "a", 1);
    await consume(key, "b", 1);
    const res = await call("GET", "/v1/requests?userId=a", { key });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].userId).toBe("a");
  });

  it("a new month starts at zero and previous months stay queryable", async () => {
    const { key, id } = await createAccount();
    await createUser(key, "u");
    const user = (await getUserByExternalId(id, "u"))!;
    await db.insert(accountUsage).values({ accountId: id, month: "2025-01-01", used: 400 });
    await db.insert(userUsage).values({ userId: user.id, month: "2025-01-01", used: 400 });

    const now = await call("GET", "/v1/usage", { key });
    expect(now.body.account.used).toBe(0);

    const past = await call("GET", "/v1/usage?month=2025-01", { key });
    expect(past.body.account.used).toBe(400);
    expect(past.body.current).toBe(false);
    expect(past.body.users[0]).toMatchObject({ userId: "u", used: 400 });

    const months = await call("GET", "/v1/usage/months", { key });
    expect(months.body.items).toContainEqual({ month: "2025-01", used: 400 });
  });

  it("rejects a malformed month or pagination", async () => {
    const { key } = await createAccount();
    expect((await call("GET", "/v1/usage?month=2025-13", { key })).status).toBe(400);
    expect((await call("GET", "/v1/requests?limit=500", { key })).status).toBe(400);
  });
});