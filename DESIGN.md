# Usage Metering & Quota Service — Design

Living document. Every decision made during implementation is added here.
It becomes the basis of the README's design, assumptions and trade-offs sections.

---

## 1. Problem

Calling applications (accounts) need to ask one question before performing an action
for one of their users:

> "Can user X consume N units right now?"

The answer depends on two plans applied together:

- the **account plan** (shared allowance for all users of the account)
- the **user plan** (individual allowance for that user)

The service records every decision and counts accepted usage.

---

## 2. System Design

```
 ┌──────────────┐  HTTP + X-API-Key   ┌─────────────────────────┐   SQL   ┌────────────┐
 │ Demo Client  │ ──────────────────> │  Metering Service (TS)  │ ──────> │ PostgreSQL │
 │ (web page)   │ <────── JSON ────── │                         │ <────── │            │
 └──────────────┘                     └─────────────────────────┘         └────────────┘
```

The client never talks to the database. Every request passes through the service,
which authenticates the caller and applies the rules.

### Layers inside the service

| Layer         | Responsibility                                   | Does NOT know about |
|---------------|--------------------------------------------------|---------------------|
| `middleware/` | Who is calling? (API key -> account)             | Rules               |
| `routes/`     | HTTP: parse, validate input, map errors to codes | SQL                 |
| `services/`   | Orchestrate the steps of each operation          | HTTP                |
| `rules/`      | PURE functions: limits + usage + units -> decision | HTTP, database    |
| `db/`         | Schema, queries, transactions                    | HTTP                |

Why: each layer can be tested and changed alone. A new rule touches `rules/` only.
Auth changes touch `middleware/` only.

### Stack

| Tool                     | Why |
|--------------------------|-----|
| Express 5                | Known from Chirpy. Catches async errors automatically. |
| Drizzle ORM + drizzle-kit| Known from Chirpy/Gator. Supports `transaction()` and `.for("update")`. |
| postgres (driver)        | Known. |
| Vitest                   | Known. |
| tsx                      | Run TypeScript directly in development (from Gator). |
| node:crypto (SHA-256)    | API key hashing, no extra dependency. |
| k6                       | Load testing. |

---

## 3. Data Model

```
plans              id, account_id?, name, scope, monthly_allowance, max_units_per_request,
                   created_at, updated_at
accounts           id, name, api_key_hash, plan_id, created_at
users              id, account_id, external_id, plan_id, created_at
account_usage      account_id, month, used
user_usage         user_id, month, used
consume_requests   id, account_id, user_id, request_id, units, accepted,
                   rejected_scope?, rejected_rule?, month, snapshot (jsonb), created_at
```
`?` = nullable

### Constraints and indexes

| Constraint | Purpose |
|---|---|
| `accounts.api_key_hash UNIQUE` | Fast key lookup, no duplicate keys |
| `users UNIQUE(account_id, external_id)` | Same user id may exist in two accounts |
| `plans UNIQUE NULLS NOT DISTINCT(account_id, name)` | Unique names per account, predefined plans not duplicated |
| `plans CHECK monthly_allowance >= 0` | Zero = frozen |
| `plans CHECK max_units_per_request >= 1` | |
| `plans CHECK scope IN ('account','user')` | |
| `account_usage PK(account_id, month)` | One counter per account per month |
| `user_usage PK(user_id, month)` | One counter per user per month |
| `usage CHECK used >= 0` | |
| `consume_requests UNIQUE(account_id, request_id)` | Idempotency |
| `consume_requests CHECK units > 0` | |
| `consume_requests INDEX(account_id, created_at DESC)` | History pagination |

All timestamps are `timestamptz`. Months are stored as `date` (first day of the UTC month).

---

## 4. Consume Flow (`POST /consume`)

```
 1. Receive request       X-API-Key + {userId, units, requestId}
 2. Validate body         -> 400
 3. Auth                  sha256(key) -> account          -> 401
 4. BEGIN transaction
 5. Idempotency check     (account_id, request_id) exists?
                          same body      -> return stored result
                          different body -> 409
 6. Load user             scoped by account_id            -> 404
 7. Ensure + lock usage   account row FIRST, then user row (FOR UPDATE)
 8. Read current plans    account plan + user plan
 9. rules.evaluate()      PURE
10. If accepted           increment account + user counters
11. Insert request record with limits snapshot
12. COMMIT -> 200 {accepted, rejection?, remaining}
```

### Known bottleneck
The account usage row is a **hot row**: all users of one account lock the same row.
This is the price of correctness. Measured in the load test.

### Failure points
| Failure | Handling |
|---|---|
| Two identical requestIds at the same moment | Unique constraint -> transaction rolls back -> return stored result |
| Deadlock | Always lock account row before user row |
| Database down | 503, nothing half-written (transaction) |

---

## 5. Product Assumptions

### Accounts and security
1. Creating an account requires an **admin key** from configuration.
2. API key is shown **once** at creation and stored as a **SHA-256 hash**.
3. A user that does not exist **or** belongs to another account -> same **404** (no information leak).
8. An account sees predefined plans + its own custom plans only.
17. User ids are supplied by the account (e.g. `"ahmed"`) and are unique **within the account**.

### Plans
9. Every plan has a fixed scope: `account` or `user`. They cannot be mixed.
10. No plan deletion (create, view, update only).
11. Predefined plans (read-only):

| Plan     | Scope   | Monthly | Max per request |
|----------|---------|---------|-----------------|
| Starter  | account | 10,000  | 100             |
| Pro      | account | 100,000 | 500             |
| Basic    | user    | 1,000   | 20              |
| Premium  | user    | 10,000  | 100             |

12. Defaults: new account -> Starter, new user -> Basic.
14. Users and accounts **reference** a plan. Updating the plan affects all of them immediately.
15. Monthly allowance >= 0, max per request >= 1. Both rules are required in every plan.
18. An account can change its own account plan.
24. A plan's scope cannot change after creation.
26. Plan names are unique within an account. Assignment is by id.

### Consumption
4. Same requestId + same body -> stored result returned, nothing consumed again.
   Same requestId + different body -> **409**.
   A rejected request retried with the same requestId stays rejected. To try again, send a new requestId.
5. requestId is unique **within the account**.
6. Rule order: user per-request -> user monthly -> account per-request -> account monthly.
   The first failing rule is returned.
16. The month is taken from the **database clock in UTC** at processing time.
19. Invalid units (not a positive integer) -> **400**, not recorded in history.
22. A rejection is **200** with `accepted: false`. Error codes are for real errors.
23. A consume request uses the plan values it reads inside its transaction.
    A plan update counts as applied when it commits.

### History and inspection
7. Both accepted and rejected requests are recorded.
13. Every request stores a **snapshot** of the limits applied, so history never changes.
20. Endpoints expose the plan and limits currently applied to the account and to each user.
25. History: newest first, `limit`/`offset` (max 100), optional filter by user and month.

### Demo
21. The client creates a demo account and users through the API on startup.

---

## 6. Design Decisions & Trade-offs

### D1. Usage counters vs summing history
- **Problem:** Every consume needs current monthly usage.
- **Alternatives:** (A) `SUM(units)` over history each time; (B) counter rows updated on accept.
- **Trade-offs:** B keeps two copies of truth (counter + history). Kept consistent by writing both in one transaction.
- **Performance:** A is O(n) in requests this month; B is O(1) by primary key.
- **Recommendation:** B. It also gives a row to lock with `FOR UPDATE`.
- **Validation:** Test that `used` equals `SUM` of accepted history after concurrent requests.

### D2. Two usage tables vs one
- **Alternatives:** One table with nullable `user_id` (null = account) vs two tables.
- **Trade-offs:** One table is shorter but puts null in the key and every query must remember `user_id IS NULL`.
- **Recommendation:** Two tables. Simpler keys, harder to misuse.

### D3. One plans table for predefined and custom plans
- **Alternatives:** Separate `predefined_plans` and `custom_plans`.
- **Trade-offs:** Two tables means `plan_id` cannot point to a single place.
- **Recommendation:** One table, `account_id = null` for predefined. Read-only enforced in the service (update allowed only when `account_id` = caller).

### D4. Rules as plan columns vs a flexible rules table
- **Alternatives:** (A) columns on `plans`; (B) `plan_rules(plan_id, type, limit)`.
- **Trade-offs:** B is flexible but needs variable rows per consume, harder validation and queries.
- **Recommendation:** A in the database, flexibility in code: each rule is a pure function in an array.
  A new rule (e.g. daily allowance) = one nullable column + one function + its counter.

### D5. Concurrency control
- **Alternatives:** `SELECT ... FOR UPDATE` / conditional `UPDATE ... WHERE used + n <= limit` / `SERIALIZABLE`.
- **Trade-offs:** Conditional UPDATE is fast but awkward with two levels and explanations. SERIALIZABLE causes many retries on the hot row.
- **Recommendation:** `FOR UPDATE`, fixed lock order (account, then user). Clear and explainable.
- **Validation:** Concurrency test: many parallel requests, total accepted never exceeds the limit.

### D6. API key hashing: SHA-256 vs argon2/bcrypt
- **Problem:** Keys must not leak if the database leaks.
- **Trade-offs:** argon2/bcrypt are slow on purpose for weak human passwords. Our keys are long and random, so brute force is not a risk.
- **Recommendation:** SHA-256. argon2 would add tens of ms to every request on the hot path.

### D7. No plan cache (v1)
- **Problem:** Plans are read on every consume.
- **Trade-offs:** A cache saves a query but can serve stale limits after an update, breaking "changes apply after the update succeeds".
- **Recommendation:** No cache. Revisit only if the load test shows plan reads are the bottleneck.

### D8. Rejection status code: 200 vs 429/403
- **Recommendation:** 200 with `accepted: false`. A rejection is a valid answer, not a failure. Callers separate business rejections from real errors easily.

### D9. Stack: Express + Drizzle vs Fastify + raw SQL
- **Trade-offs:** Fastify is slightly faster; raw SQL shows locking more directly.
  The real bottleneck is the database hot row, not the framework. Learning new tools costs days.
- **Recommendation:** Express + Drizzle (known tools). Locking stays explicit via `transaction()` + `.for("update")`.

### D10. Monorepo folders
- **Alternatives:** Separate repositories for service and client.
- **Recommendation:** One repository (deliverable requires it), one folder per container:
  `service/`, `client/`, `load-tests/`.

---

## 7. Known Limitations
- No deletion of accounts or users.
- No API key rotation; one key per account.
- Users cannot move between accounts.
- No plan deletion.
- Single database instance; the account usage row is a contention point under heavy load for one account.
