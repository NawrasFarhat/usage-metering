import express from "express";
import { randomUUID } from "node:crypto";

const METERING_URL = process.env.METERING_URL ?? "http://localhost:8080";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key-change-me";
const PORT = Number(process.env.PORT ?? 3000);

const PREDEFINED = {
  basic: "00000000-0000-0000-0000-000000000003",
  premium: "00000000-0000-0000-0000-000000000004",
};

let demo = null;

async function metering(method, path, body, headers = {}) {
  const res = await fetch(METERING_URL + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const withKey = () => ({ "X-API-Key": demo.apiKey });

async function must(promise) {
  const res = await promise;
  if (res.status >= 300) throw new Error(`metering service returned ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data;
}


async function setupDemo() {
  const account = await must(metering("POST", "/admin/accounts", { name: "DocsApp (demo)" }, { "X-Admin-Key": ADMIN_API_KEY }));
  demo = { apiKey: account.apiKey };
  const team = await must(metering("POST", "/v1/plans",
    { name: "DocsApp Team", scope: "account", monthlyAllowance: 300, maxUnitsPerRequest: 100 }, withKey()));
  demo.teamPlanId = team.id;
  await must(metering("PUT", "/v1/account/plan", { planId: team.id }, withKey()));
  await must(metering("POST", "/v1/users", { userId: "alice", planId: PREDEFINED.basic }, withKey()));
  await must(metering("POST", "/v1/users", { userId: "bob", planId: PREDEFINED.premium }, withKey()));
  console.log("Demo account ready (DocsApp Team plan, users alice and bob)");
}

async function waitForService() {
  for (let attempt = 1; attempt <= 60; attempt++) {
    try {
      const res = await fetch(METERING_URL + "/health");
      if (res.ok) return;
    } catch {}
    console.log(`waiting for metering service (${attempt})...`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("metering service not reachable");
}

const app = express();
app.use(express.json());
app.use(express.static("public"));

app.get("/api/state", async (_req, res) => {
  const [usage, plans, history] = await Promise.all([
    must(metering("GET", "/v1/usage", undefined, withKey())),
    must(metering("GET", "/v1/plans", undefined, withKey())),
    must(metering("GET", "/v1/requests?limit=8", undefined, withKey())),
  ]);
  res.json({ usage, plans: plans.items, history: history.items, teamPlanId: demo.teamPlanId });
});

app.post("/api/process", async (req, res) => {
  const { userId, units, requestId } = req.body;
  const result = await metering("POST", "/v1/consume", { userId, units, requestId: requestId ?? randomUUID() }, withKey());
  res.status(result.status).json(result.data);
});

app.post("/api/retry-demo", async (req, res) => {
  const requestId = randomUUID();
  const body = { userId: req.body.userId, units: req.body.units, requestId };
  const first = await metering("POST", "/v1/consume", body, withKey());
  const second = await metering("POST", "/v1/consume", body, withKey());
  res.json({ first: first.data, second: second.data });
});

app.put("/api/users/:userId/plan", async (req, res) => {
  const result = await metering("PUT", `/v1/users/${encodeURIComponent(req.params.userId)}/plan`, { planId: req.body.planId }, withKey());
  res.status(result.status).json(result.data);
});

app.patch("/api/team-plan", async (req, res) => {
  const result = await metering("PATCH", `/v1/plans/${demo.teamPlanId}`, { monthlyAllowance: req.body.monthlyAllowance }, withKey());
  res.status(result.status).json(result.data);
});

app.post("/api/reset", async (_req, res) => {
  await setupDemo();
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(502).json({ error: { message: err.message } });
});

await waitForService();
await setupDemo();
app.listen(PORT, () => console.log(`DocsApp demo on http://localhost:${PORT}`));