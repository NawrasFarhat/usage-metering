import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, stopServer, call, createAccount, PLANS } from "./helpers.js";
import { closeDb } from "../src/db/index.js";

beforeAll(startServer);
afterAll(async () => { await stopServer(); await closeDb(); });

describe("API key authentication", () => {
  it("rejects a request without an API key", async () => {
    const res = await call("GET", "/v1/account");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("rejects an invalid API key with the same error", async () => {
    const res = await call("GET", "/v1/account", { key: "mk_not_a_real_key" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("accepts a valid API key and identifies the account", async () => {
    const { key, id } = await createAccount();
    const res = await call("GET", "/v1/account", { key });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.plan.name).toBe("Starter");
  });

  it("protects every /v1 endpoint, including consume", async () => {
    const res = await call("POST", "/v1/consume", { body: { userId: "a", units: 1, requestId: "r" } });
    expect(res.status).toBe(401);
  });
});

describe("admin account creation", () => {
  it("requires the admin key", async () => {
    const res = await call("POST", "/admin/accounts", { body: { name: "X" } });
    expect(res.status).toBe(401);
  });

  it("does not accept an account API key as admin key", async () => {
    const { key } = await createAccount();
    const res = await call("POST", "/admin/accounts", { key, body: { name: "X" } });
    expect(res.status).toBe(401);
  });

  it("returns the API key once and only stores its hash", async () => {
    const res = await call("POST", "/admin/accounts", { admin: true, body: { name: "Hash check" } });
    expect(res.status).toBe(201);
    expect(res.body.apiKey).toMatch(/^mk_[0-9a-f]{64}$/);
    expect(res.body.apiKeyHash).toBeUndefined();
  });

  it("only allows predefined account plans for a new account", async () => {
    const res = await call("POST", "/admin/accounts", { admin: true, body: { name: "X", planId: PLANS.basic } });
    expect(res.status).toBe(400);
  });

  it("validates the planId format (400, not 500)", async () => {
    const res = await call("POST", "/admin/accounts", { admin: true, body: { name: "X", planId: "abc" } });
    expect(res.status).toBe(400);
  });
});