import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const ADMIN_KEY = __ENV.ADMIN_KEY || "dev-admin-key-change-me";
const SCENARIO = __ENV.SCENARIO || "spread";
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || "30s";
const ACCOUNTS = SCENARIO === "hot" ? 1 : Number(__ENV.ACCOUNTS || 20);
const USERS_PER_ACCOUNT = Number(__ENV.USERS || 10);

const accepted = new Counter("consume_accepted");
const rejected = new Counter("consume_rejected");

export const options = {
  scenarios: {
    consume: { executor: "constant-vus", vus: VUS, duration: DURATION },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:consume}": ["p(95)<500"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function json(method, path, body, headers) {
  const res = http.request(method, BASE_URL + path, body ? JSON.stringify(body) : null, {
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    tags: { name: "setup" },
  });
  if (res.status >= 300) fail(`${method} ${path} -> ${res.status} ${res.body}`);
  return res.json();
}

// Accounts and users with very large plans, so requests are accepted
// and we measure the full write path (locks + counter updates + history insert).
export function setup() {
  const accounts = [];
  for (let a = 0; a < ACCOUNTS; a++) {
    const created = json("POST", "/admin/accounts", { name: `load-${SCENARIO}-${Date.now()}-${a}` }, { "X-Admin-Key": ADMIN_KEY });
    const auth = { "X-API-Key": created.apiKey };
    const accountPlan = json("POST", "/v1/plans", { name: "Load account", scope: "account", monthlyAllowance: 1000000000, maxUnitsPerRequest: 100 }, auth);
    json("PUT", "/v1/account/plan", { planId: accountPlan.id }, auth);
    const userPlan = json("POST", "/v1/plans", { name: "Load user", scope: "user", monthlyAllowance: 100000000, maxUnitsPerRequest: 100 }, auth);
    const users = [];
    for (let u = 0; u < USERS_PER_ACCOUNT; u++) {
      json("POST", "/v1/users", { userId: `user-${u}`, planId: userPlan.id }, auth);
      users.push(`user-${u}`);
    }
    accounts.push({ key: created.apiKey, users });
  }
  return { accounts };
}

export default function (data) {
  const account = data.accounts[Math.floor(Math.random() * data.accounts.length)];
  const userId = account.users[Math.floor(Math.random() * account.users.length)];
  const body = JSON.stringify({ userId, units: 1, requestId: `${__VU}-${__ITER}-${Math.random()}` });

  const res = http.post(`${BASE_URL}/v1/consume`, body, {
    headers: { "Content-Type": "application/json", "X-API-Key": account.key },
    tags: { name: "consume" },
  });

  const ok = check(res, { "status is 200": (r) => r.status === 200 });
  if (ok && res.json("accepted")) accepted.add(1);
  else rejected.add(1);
}

export function teardown(data) {
  for (const account of data.accounts) {
    const usage = http.get(`${BASE_URL}/v1/usage?limit=100`, { headers: { "X-API-Key": account.key } }).json();
    const sumUsers = usage.users.reduce((s, u) => s + u.used, 0);
    if (usage.account.used !== sumUsers) {
      fail(`MISMATCH: account used ${usage.account.used} != sum of users ${sumUsers}`);
    }
  }
  console.log(`teardown: totals consistent for ${data.accounts.length} account(s)`);
}
