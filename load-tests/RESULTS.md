# Load test results

## How it was tested

- Tool: [k6](https://k6.io), script [`consume.js`](consume.js), run with Docker (`grafana/k6`) on the compose network.
- Endpoint: `POST /v1/consume`, the hot path. Every request uses a new `requestId` and 1 unit, and plans are
  very large, so every request is **accepted** and runs the full write path:
  auth, idempotency lookup, row locks, rule evaluation, counter updates, history insert, commit.
- Two scenarios:
  - **spread**: 20 accounts x 10 users. Requests rarely compete for the same row.
  - **hot**: 1 account x 10 users. Every request locks the **same account counter row**.
- Machine: one laptop (Windows + WSL + Docker Desktop) running Postgres, the service **and** k6 at the same time.
  Absolute numbers are therefore pessimistic; the comparisons are what matter.
- After every run, k6 `teardown()` checks that each account's total equals the sum of its users' totals.

## Results

| Scenario | Virtual users | Requests/s | p50 | p95 | p99 | Errors | Totals consistent |
|---|---|---|---|---|---|---|---|
| spread | 50 | **205** | 176 ms | 482 ms | 578 ms | 0% | yes |
| hot | 50 | **90** | 503 ms | 967 ms | 1.22 s | 0% | yes |
| spread | 10 | **177** | **42 ms** | **108 ms** | 144 ms | 0% | yes |

## What the numbers show

1. **Correct under load.** 0 failed requests in every run, and every account total matched the sum of its
   users after the run. Locks and transactions hold under concurrency, not only in tests.
2. **At 50 virtual users, latency is mostly queueing.** With 10 users, a consume takes about 42 ms (p50).
   With 50 users in flight on a machine that serves about 200 requests/s, each request waits for its turn.
3. **The hot account is the cost of correctness.** With one account, every request waits for the previous
   one to commit its update of the same account counter row. Throughput drops from 205 to 90 requests/s and
   p95 goes over the 500 ms target. This is expected: that serialization is exactly what prevents two
   requests from spending the same remaining units.

## Ideas not implemented (and why)

- **Cache plans in memory**: saves queries, but a cached plan could be stale after an update, breaking
  "plan changes apply to the next request". Would need invalidation.
- **Sharded account counters** (N sub-rows per account, summed on read) to relieve the hot row for very large
  accounts. More complex; one service and one database are enough for this scope.
- **Several service instances**: the service is stateless and all locking is in Postgres, so this works
  without code changes and would raise the spread throughput.

## Reproduce

Start the stack (`docker compose up -d --build`), then:

```bash
docker run --rm -i --network usage-metering_default -e BASE_URL=http://service:8080 -e SCENARIO=spread grafana/k6 run - < load-tests/consume.js
docker run --rm -i --network usage-metering_default -e BASE_URL=http://service:8080 -e SCENARIO=hot    grafana/k6 run - < load-tests/consume.js
docker run --rm -i --network usage-metering_default -e BASE_URL=http://service:8080 -e SCENARIO=spread -e VUS=10 -e DURATION=20s grafana/k6 run - < load-tests/consume.js
```

Options: `SCENARIO` (spread | hot), `VUS` (default 50), `DURATION` (default 30s), `ACCOUNTS`, `USERS`, `ADMIN_KEY`.
