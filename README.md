# Usage Metering and Quota Service

A backend service that other applications call before performing an action for one of their users:
**"Can user X consume N units right now?"** The answer checks two plans together: the calling
application's **account plan** (a shared monthly allowance) and the user's **user plan** (an individual allowance).
Every decision is recorded, and accepted usage is counted.

- TypeScript + Express 5 + Drizzle ORM + PostgreSQL
- One service, one database, plus a small demo client
- 43 automated tests (unit + integration + concurrency), k6 load tests with results

---

## Contents

1. [Quick start](#quick-start)
2. [The demo client](#the-demo-client)
3. [Concepts: accounts, users, plans, units](#concepts)
4. [API keys](#api-keys)
5. [API reference](#api-reference)
6. [Rules and how a request is decided](#rules)
7. [Plan changes](#plan-changes)
8. [Retries and idempotency](#retries-and-idempotency)
9. [Concurrency](#concurrency)
10. [Product assumptions](#product-assumptions)
11. [Design decisions](#design-decisions)
12. [Tests](#tests)
13. [Performance](#performance)
14. [Local development](#local-development)
15. [Known limitations](#known-limitations)
16. [Project layout](#project-layout)

---

## Quick start

Requirements: Docker with Docker Compose.

```bash
docker compose up --build
```

This starts:

| Container | URL | What it is |
|---|---|---|
| `db` | `localhost:5433` | PostgreSQL 17 (data in the `pgdata` volume, survives restarts) |
| `service` | http://localhost:8080 | The metering service. Applies migrations (tables + predefined plans) on startup |
| `client` | http://localhost:3000 | Demo app "DocsApp" that uses the service |

Configuration (all have working defaults for local use):

| Variable | Used by | Default |
|---|---|---|
| `ADMIN_API_KEY` | service, client | `dev-admin-key-change-me` (override: `ADMIN_API_KEY=... docker compose up --build`) |
| `DB_URL` | service | set in `docker-compose.yml` |

Check it is up: `curl localhost:8080/health` returns `{"status":"ok"}`.

To start from an empty database: `docker compose down -v` (deletes the volume).

---

## The demo client

Open **http://localhost:3000**.

On startup the client creates a demo account through the API, exactly like a real customer would:

- the account is put on a custom account plan **"DocsApp Team"**: 300 units/month, 100 per request
- **alice** is on **Basic** (1,000/month, 20 per request)
- **bob** is on **Premium** (10,000/month, 100 per request)

Then follow the steps on the page:

1. Alice processes a 10-unit document: **accepted**.
2. Alice processes a 25-unit document: **rejected by her user plan** (`user` / `max_units_per_request`).
3. Bob processes 100-unit documents: the third one is **rejected by the shared account plan** (`account` / `monthly_allowance`), even though Bob has plenty left.
4. Switch Alice to Premium and retry 25 units: accepted. Her usage is kept.
5. Raise the team allowance to 1,000: Bob can continue.
6. "Send twice" sends one request id twice: it is consumed once (the second call is `replayed: true`).

The client code never changes; only plans do.

The client is a small Express backend plus a web page. The backend holds DocsApp's API key,
because an API key must never be sent to a browser. "Start over" creates a fresh demo account.

---

## Concepts

| Concept | Meaning |
|---|---|
| **Account** | An application/company calling the service (e.g. DocsApp). Has one API key and one **account plan**: limits shared by all its users. |
| **User** | A user of that application, registered under the account with the account's own id (e.g. `"ahmed"`). Has one **user plan**: individual limits. |
| **Plan** | A named set of rules with a scope: `account` or `user`. Predefined (read-only) or custom (owned by one account). Many users can share a plan; each keeps their own usage. |
| **Units** | The single resource being consumed (e.g. document processing credits). |

### Predefined plans

Created by a migration when the service starts. Read-only. Fixed ids so they can be referenced directly.

| Plan | Scope | Monthly allowance | Max per request | Id |
|---|---|---|---|---|
| Starter | account | 10,000 | 100 | `00000000-0000-0000-0000-000000000001` |
| Pro | account | 100,000 | 500 | `00000000-0000-0000-0000-000000000002` |
| Basic | user | 1,000 | 20 | `00000000-0000-0000-0000-000000000003` |
| Premium | user | 10,000 | 100 | `00000000-0000-0000-0000-000000000004` |

New accounts start on **Starter**, new users on **Basic**, unless a plan is given.

### Database

| Table | Holds |
|---|---|
| `plans` | Predefined (`account_id` null) and custom plans (`account_id` = owner) |
| `accounts` | Name, SHA-256 hash of the API key, current plan |
| `users` | Account, the account's own user id (`external_id`), current plan |
| `account_usage` | One counter row per account per UTC month |
| `user_usage` | One counter row per user per UTC month |
| `consume_requests` | Every decision (accepted and rejected) with a snapshot of the limits applied |

Key constraints: `UNIQUE(account_id, request_id)` (idempotency), `UNIQUE(account_id, external_id)`,
`UNIQUE NULLS NOT DISTINCT(account_id, name)` on plans, `CHECK` constraints on all limits and units,
no `ON DELETE CASCADE` (history is never deleted as a side effect).

---

## API keys

1. An operator creates an account with the **admin key** (from `ADMIN_API_KEY`):

   ```bash
   curl -X POST localhost:8080/admin/accounts \
     -H "X-Admin-Key: dev-admin-key-change-me" \
     -H "Content-Type: application/json" \
     -d '{"name": "DocsApp"}'
   ```

   ```json
   { "id": "c8f2...", "name": "DocsApp", "planId": "00000000-0000-0000-0000-000000000001",
     "apiKey": "mk_35ffe7b8...", "createdAt": "..." }
   ```

   Optional: `"planId"` of a predefined account plan (Starter or Pro).

2. **The API key is returned once.** The service stores only its SHA-256 hash.

3. Every `/v1` request sends it in the `X-API-Key` header. The key identifies the account; every
   query is scoped to that account. Missing or invalid key: `401`.

```bash
export KEY=mk_35ffe7b8...
curl localhost:8080/v1/account -H "X-API-Key: $KEY"
```

---

## API reference

All bodies are JSON. Errors always look like:

```json
{ "error": { "code": "not_found", "message": "User \"khaled\" not found" } }
```

| Status | When | Example `code` |
|---|---|---|
| 400 | Invalid input | `bad_request`, `invalid_json`, `invalid_plan_scope` |
| 401 | Missing or invalid API key / admin key | `unauthorized` |
| 403 | Allowed caller, forbidden action (editing a predefined plan) | `forbidden` |
| 404 | Not found, **or belongs to another account** (same answer, nothing leaks) | `not_found` |
| 409 | Conflict with existing data | `idempotency_conflict`, `user_exists`, `plan_name_taken` |
| 500 | Unexpected server error (details only in server logs) | `internal_error` |

A **rejection by a rule is not an error**: `POST /v1/consume` returns `200` with `"accepted": false`.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| POST | `/admin/accounts` | Create an account and its API key (admin key) |
| GET | `/v1/account` | The account and the plan currently applied to it |
| PUT | `/v1/account/plan` | Switch the account plan `{ planId }` |
| GET | `/v1/plans` | Predefined plans + this account's custom plans |
| GET | `/v1/plans/:planId` | One plan |
| POST | `/v1/plans` | Create a custom plan |
| PATCH | `/v1/plans/:planId` | Update a custom plan (predefined: 403) |
| POST | `/v1/users` | Register a user `{ userId, planId? }` |
| GET | `/v1/users` | List users (`limit`, `offset`) |
| GET | `/v1/users/:userId` | The user, their current plan and this month's usage |
| PUT | `/v1/users/:userId/plan` | Switch the user's plan `{ planId }` |
| GET | `/v1/users/:userId/usage?month=YYYY-MM` | User usage for a month |
| GET | `/v1/users/:userId/usage/months` | User usage for every month with activity |
| **POST** | **`/v1/consume`** | **Consume units for a user** |
| GET | `/v1/usage?month=YYYY-MM` | Account usage + every user's usage for a month (`limit`, `offset` over users) |
| GET | `/v1/usage/months` | Account usage for every month with activity |
| GET | `/v1/requests?userId=&month=YYYY-MM&limit=&offset=` | Decision history, newest first |

### Examples

Register users:

```bash
curl -X POST localhost:8080/v1/users -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"userId": "ahmed"}'                                                  # Basic
curl -X POST localhost:8080/v1/users -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"userId": "sara", "planId": "00000000-0000-0000-0000-000000000004"}'  # Premium
```

Consume units:

```bash
curl -X POST localhost:8080/v1/consume -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"userId": "ahmed", "units": 10, "requestId": "doc-123"}'
```

```json
{
  "requestId": "doc-123",
  "accepted": true,
  "rejection": null,
  "userId": "ahmed",
  "units": 10,
  "month": "2026-10",
  "user":    { "plan": { "id": "...0003", "name": "Basic" },   "monthlyAllowance": 1000,  "maxUnitsPerRequest": 20,  "used": 10, "remaining": 990 },
  "account": { "plan": { "id": "...0001", "name": "Starter" }, "monthlyAllowance": 10000, "maxUnitsPerRequest": 100, "used": 10, "remaining": 9990 },
  "replayed": false,
  "processedAt": "2026-10-19T10:19:49.713Z"
}
```

A rejection (same request with 25 units):

```json
{
  "accepted": false,
  "rejection": {
    "scope": "user",
    "rule": "max_units_per_request",
    "message": "User plan allows at most 20 units per request; 25 requested"
  },
  "user": { "used": 0, "remaining": 1000, "...": "..." },
  "account": { "used": 0, "remaining": 10000, "...": "..." }
}
```

Create and assign a custom plan:

```bash
curl -X POST localhost:8080/v1/plans -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name": "Gold", "scope": "user", "monthlyAllowance": 5000, "maxUnitsPerRequest": 50}'
curl -X PUT localhost:8080/v1/users/ahmed/plan -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"planId": "<gold plan id>"}'
curl -X PATCH localhost:8080/v1/plans/<gold plan id> -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"monthlyAllowance": 8000}'
```

Usage and history:

```bash
curl "localhost:8080/v1/usage" -H "X-API-Key: $KEY"
curl "localhost:8080/v1/usage?month=2026-09" -H "X-API-Key: $KEY"
curl "localhost:8080/v1/requests?userId=ahmed&limit=20&offset=0" -H "X-API-Key: $KEY"
```

---

## Rules

Two rule types, applied to **both** the account plan and the user plan:

| Rule | Meaning |
|---|---|
| `max_units_per_request` | The largest amount that can be consumed in a single request |
| `monthly_allowance` | Total units available during a UTC calendar month |

A request is accepted only if **all four checks** pass, in this fixed order; the first failure is reported:

1. user `max_units_per_request`
2. user `monthly_allowance`
3. account `max_units_per_request`
4. account `monthly_allowance`

An accepted request adds its units to the user's counter **and** the account's counter (the same action).
A rejected request consumes nothing, and is still recorded in the history.

`remaining = max(0, monthlyAllowance - used)`.

The decision is a **pure function** (`service/src/rules/rules.ts`): limits + usage + units in, decision out.
Rules are a list; adding a rule (for example a daily allowance) means adding one entry to `RULES`,
its limit column on `plans` and its counter. See [Design decisions](#design-decisions).

---

## Plan changes

- Plans are stored in the database and read on every request: **no redeploy, no cache**.
  A change applies to every request that starts after the update commits.
- Users and accounts **reference** a plan. Updating a custom plan affects every account/user on it.
- **Switching plans keeps usage.** Counters belong to the user/account and the month, not to the plan,
  so a switch never grants a fresh allowance.
- **Allowance reduced below usage**: `remaining` shows `0` and further requests are rejected
  by `monthly_allowance` until allowance is available again (a raise, a plan switch, or a new month).
- **History is never rewritten.** Each request stores a `snapshot` of the plans and usage it was decided with.
- A plan's `scope` cannot change after creation. Predefined plans are read-only (`403`).
- Plans are visible to an account only if predefined or owned by it. Another account's plan is `404`.

---

## Retries and idempotency

Every consume request carries a `requestId` chosen by the caller, unique **per account**.

| Situation | Result |
|---|---|
| Same `requestId`, same `userId` and `units` | The **stored result** is returned (`"replayed": true`). Nothing is consumed again. |
| Same `requestId`, different `userId` or `units` | `409 idempotency_conflict` (almost certainly a caller bug) |
| A rejected request retried with the same `requestId` | Stays rejected. To try again, send a **new** `requestId`: that is a new attempt, not a retry. |
| Same `requestId` sent many times **at the same moment** | Consumed exactly once (enforced by `UNIQUE(account_id, request_id)`; covered by a test) |

So a client can safely retry on timeouts or network errors.

---

## Concurrency

The problem: an account has 10 units left and two 10-unit requests arrive at the same moment.
If both read "10 left" before either writes, both are accepted and the account ends at 20/10.

The solution, inside **one transaction** per consume:

1. Lock this month's **account** counter row, then the **user** counter row.
   `INSERT ... ON CONFLICT DO UPDATE ... RETURNING used` creates the row if it is the month's first request
   and holds a row lock until commit (same effect as `SELECT ... FOR UPDATE`).
   Other requests for the same account **wait**, then read the updated total.
2. Evaluate the rules with the locked values.
3. Update both counters and insert the history row.
4. Commit. Any failure rolls back everything, so totals and history never disagree.

**Lock order is always account, then user**, so two requests can never deadlock.

The cost: requests for the **same account** are serialized on the account row (a "hot row").
That is measured in [Performance](#performance).

---

## Product assumptions

The brief leaves some behavior open. These are the choices made and applied everywhere.

**Accounts and security**
1. Accounts are created by an operator with an **admin key** from configuration (not open sign-up).
2. API keys are random (32 bytes), shown **once**, stored as **SHA-256** hashes.
3. A user (or plan) that does not exist and one that belongs to another account get the **same `404`**.
4. An account sees predefined plans + its own custom plans only.
5. User ids are chosen by the account (e.g. `"ahmed"`) and are unique **within the account**; two accounts can both have `"ahmed"`.
6. Users must be **registered** before consuming; consume for an unknown user is `404` (no auto-creation, which could hide typos).

**Plans**

7. Every plan has a fixed scope (`account` or `user`); a user plan cannot be assigned to an account and vice versa.
8. No plan deletion (create, view, update only).
9. Both rules are required in every plan: `monthlyAllowance >= 0` (0 = frozen), `maxUnitsPerRequest >= 1`. No "unlimited".
10. A new account starts on Starter, a new user on Basic. A new account can start only on a predefined account plan.
11. Plan names are unique within an account. Plans are assigned by id.

**Consumption**

12. `units` must be a positive whole number; invalid input is `400` and is **not** recorded in history.
13. A rejection is `200` with `accepted: false`; HTTP errors are for real errors.
14. The month comes from the **database clock in UTC** at processing time, not from the client.
15. A request uses the plan values it reads inside its transaction; a plan update counts as applied once committed.

**Usage and history**

16. Both accepted and rejected decisions are recorded.
17. History is newest first, with `limit` (1 to 100, default 20) / `offset`, filterable by user and month.
18. `remaining` is reported for the **current month** only (measured against the plan applied now). For past months only `used` is reported (`remaining: null`), because the plan may have changed since.

**Demo**

19. The demo client creates its own demo account on startup (and on "Start over"). It keeps the API key in memory only.

---

## Design decisions

The full reasoning (problem, alternatives, trade-offs) is in [DESIGN.md](DESIGN.md). Summary:

| Decision | Chosen | Main alternative | Why |
|---|---|---|---|
| Usage storage | Counter rows per month | `SUM()` over history | O(1) vs O(n) per request; and a counter row is something to **lock** |
| Concurrency | Row locks in one transaction, fixed lock order | `SERIALIZABLE`, conditional `UPDATE ... WHERE used + n <= limit` | Correct across two levels, easy to explain; SERIALIZABLE would retry constantly on the hot row |
| Idempotency | `UNIQUE(account_id, request_id)` + stored result | Check-then-insert in code | The constraint holds even when duplicates race |
| History | Snapshot (jsonb) of limits and usage on each request | Reference the plan only | History must not change when a plan changes |
| API key hash | SHA-256 | argon2/bcrypt | Keys are random (no brute force); SHA-256 is deterministic so the key can be **looked up** by hash with an index; argon2 is salted and slow on every request |
| Plans table | One table, `account_id` null = predefined | Two tables | Users/accounts reference a plan with one foreign key |
| Rules | Two columns on `plans` + rules as a list of pure functions | Generic `plan_rules` table | Simple queries now; adding a rule is still small |
| Layers | `routes` (HTTP) / `middleware` (auth) / `services` (flow) / `rules` (pure) / `db/queries` (SQL) | Everything in route handlers | Each part can be read, tested and changed alone |
| Errors | `AppError` subclasses carry status + stable `code` | Per-type `if` in the handler | One branch in the handler; clients branch on `code`, not message text |
| Plan cache | None | In-memory cache | Would risk stale limits after an update |
| Demo client | Small backend + page | Page calling the service directly | The API key stays secret; matches how a real customer integrates |

---

## Tests

```bash
docker compose up -d db          # tests use the database on localhost:5433
cd service
cp .env.example .env
npm install
npm test
```

43 tests (Vitest):

| File | Covers |
|---|---|
| `src/rules/rules.test.ts` | Pure rule logic: accept, user per-request limit, account monthly limit |
| `test/auth.test.ts` | Missing/invalid API key, admin key, key shown once, plan validation |
| `test/isolation.test.ts` | Same user id in two accounts, cross-account users/plans are 404, per-account request ids, history isolation |
| `test/consume.test.ts` | Accept / user limit / account limit, validation, retries, 409 conflict, plan changes, reduced allowance, shared plans, snapshot history, read-only plans, scope checks |
| `test/concurrency.test.ts` | 60 parallel requests on a 100-unit account: exactly 20 accepted and account total = sum of users = sum of history; 20 identical requestIds at once consumed once; user limit under concurrency |
| `test/history.test.ts` | Pagination, newest first, filtering, new month starts at 0, past months queryable |

Integration tests start the real Express app on a random port and call it over HTTP against the real
database. Each test creates its own account, so tests never interfere.

---

## Performance

Tested with k6 against `POST /v1/consume`, in two scenarios: many accounts (`spread`) and one account
that every request competes for (`hot`). Full method and analysis: [load-tests/RESULTS.md](load-tests/RESULTS.md).

One laptop (WSL + Docker Desktop) running Postgres, the service and k6 together:

| Scenario | Virtual users | Requests/s | p50 | p95 | Errors | Totals consistent |
|---|---|---|---|---|---|---|
| spread (20 accounts) | 50 | 205 | 176 ms | 482 ms | 0% | yes |
| hot (1 account) | 50 | 90 | 503 ms | 967 ms | 0% | yes |
| spread (20 accounts) | 10 | 177 | 42 ms | 108 ms | 0% | yes |

- No errors, and after every run each account total equals the sum of its users' totals.
- At 50 virtual users most latency is queueing; with 10, a consume takes about 42 ms (p50).
- The hot account is the cost of correctness: requests for one account are serialized on its counter row.

Run it (stack running):

```bash
docker run --rm -i --network usage-metering_default -e BASE_URL=http://service:8080 -e SCENARIO=spread grafana/k6 run - < load-tests/consume.js
docker run --rm -i --network usage-metering_default -e BASE_URL=http://service:8080 -e SCENARIO=hot    grafana/k6 run - < load-tests/consume.js
```

---

## Local development

```bash
docker compose up -d db
cd service
cp .env.example .env
npm install
npm run dev          # http://localhost:8080, restarts on file changes, applies migrations on start
```

Other scripts: `npm run build`, `npm start`, `npm run db:generate` (new migration
after changing `src/db/schema.ts`).

---

## Known limitations

- No deletion of accounts, users or plans; no API key rotation; one key per account.
- Users cannot move between accounts.
- Requests for the same account are serialized on its counter row. Fine for this scope; very large
  accounts would need sharded counters (see RESULTS.md).
- The month boundary is UTC only; no per-account time zones.
- Some cross-table rules (a plan's scope matches where it is assigned; a request's user belongs to its
  account) are enforced in the service layer and covered by tests, not by database constraints.
- Remaining allowance is reported for the current month only.
- No rate limiting of the API itself (requests per second); only unit quotas.
- The demo client keeps its API key in memory; restarting it creates a new demo account.

---

## Project layout

```
.
├── docker-compose.yml        db + service + client
├── DESIGN.md                 decisions and trade-offs in detail
├── service/
│   ├── src/
│   │   ├── index.ts          start: run migrations, then listen
│   │   ├── app.ts            build the Express app (routes + middleware)
│   │   ├── config.ts         environment variables
│   │   ├── errors.ts         AppError + 400/401/403/404/409 classes
│   │   ├── validation.ts     runtime validation of request input
│   │   ├── month.ts          UTC month helpers
│   │   ├── middleware/       auth (API key, admin key), error handler
│   │   ├── routes/           HTTP only: parse input, call a service, shape output
│   │   ├── services/         the flow of each operation (consume.ts is the core)
│   │   ├── rules/            pure decision logic + unit tests
│   │   ├── auth/             key generation and hashing
│   │   └── db/               schema, migrations, queries
│   └── test/                 integration and concurrency tests
├── client/                   demo app "DocsApp" (Express backend + one HTML page)
└── load-tests/               k6 script, results and analysis
```
