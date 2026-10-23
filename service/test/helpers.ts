import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { runMigrations } from "../src/db/migrate.js";
import { config } from "../src/config.js";



export const PLANS = {
  starter: "00000000-0000-0000-0000-000000000001",
  pro: "00000000-0000-0000-0000-000000000002",
  basic: "00000000-0000-0000-0000-000000000003",
  premium: "00000000-0000-0000-0000-000000000004",
};

let server: Server;
let baseUrl: string;

export async function startServer() {
  await runMigrations();
  server = createApp().listen(0); // port 0 = any free port
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function stopServer() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export async function call(method: string, path: string, options: { key?: string; admin?: boolean; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.key) headers["X-API-Key"] = options.key;
  if (options.admin) headers["X-Admin-Key"] = config.adminApiKey;
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export function uniqueId(prefix = "id") {
  return `${prefix}-${randomUUID()}`;
}

export async function createAccount(plan?: { monthlyAllowance: number; maxUnitsPerRequest: number }) {
  const created = await call("POST", "/admin/accounts", { admin: true, body: { name: uniqueId("acct") } });
  const key: string = created.body.apiKey;
  if (plan) {
    const p = await call("POST", "/v1/plans", { key, body: { name: "Test account plan", scope: "account", ...plan } });
    await call("PUT", "/v1/account/plan", { key, body: { planId: p.body.id } });
  }
  return { key, id: created.body.id as string };
}

export async function createUserPlan(key: string, monthlyAllowance: number, maxUnitsPerRequest: number) {
  const res = await call("POST", "/v1/plans", {
    key,
    body: { name: uniqueId("user-plan"), scope: "user", monthlyAllowance, maxUnitsPerRequest },
  });
  return res.body.id as string;
}

export async function createUser(key: string, userId: string, planId?: string) {
  return call("POST", "/v1/users", { key, body: { userId, planId } });
}

export async function consume(key: string, userId: string, units: number, requestId = uniqueId("req")) {
  return call("POST", "/v1/consume", { key, body: { userId, units, requestId } });
}