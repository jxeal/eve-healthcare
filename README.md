# EVE Healthcare — Diagnostic Bookings + Simulated Payments (Express.js)

Node 20 + Express 4 + Prisma (PostgreSQL 16) + Redis + JWT + zod + pino.
Patients book diagnostic tests at centres, pay through a **simulated** gateway,
and the provider reports back via an **idempotent webhook**. Swagger UI at
`GET /api-docs`, health at `GET /health`.

## Run locally

```bash
cp .env.example .env            # adjust DATABASE_URL / REDIS_URL / JWT_SECRET
docker compose up -d postgres redis   # or use your own Postgres 16 + Redis 7
npx prisma migrate dev          # creates DB + applies migrations
npm run seed                    # optional demo data (3 centres × 2–3 tests)
npm run dev                     # watch mode → http://localhost:3000
```

Tests (needs Postgres + Redis up):

```bash
npm test                                     # full frozen suite
npx jest tests/integration/payments.webhook.test.js --runInBand   # Agent-4 area
node scripts/smoke-payments.js               # Agent-4 smoke mirror (see note below)
```

Docker (all services):

```bash
JWT_SECRET=long-random-secret docker compose up --build
```

## Endpoint table

| Method & Path | Auth | Success | Errors |
|---|---|---|---|
| `POST /api/v1/auth/signup` `{name,email,password≥6}` | no | 201 `{user,token}` | 409 dup, 422 invalid |
| `POST /api/v1/auth/login` `{email,password}` | no | 200 `{user,token}` | 401 bad creds, 422 |
| `GET /api/v1/auth/me` | Bearer | 200 `{user}` | 401 |
| `GET /api/v1/centres?page&limit&search` | no | 200 `{data,pagination}` | — |
| `POST /api/v1/centres` `{name,location,address?,phone?}` | Bearer | 201 centre | 401, 422 |
| `GET /api/v1/centres/:id` | no | 200 centre | 404 |
| `GET /api/v1/centres/:centreId/tests` | no | 200 `[{test}]` | 404 centre |
| `POST /api/v1/centres/:centreId/tests` `{name,price>0,…}` | Bearer | 201 test | 401/404/409 dup-name/422 |
| `GET /api/v1/tests?centreId=&page&limit` | no | 200 `{data,pagination}` | — |
| `POST /api/v1/bookings` `{centreId,testId,appointmentAt future}` | Bearer | 201 PENDING + amount snapshot | 401/404/422 |
| `GET /api/v1/bookings?page&limit` (own only) | Bearer | 200 `{data,pagination}` | 401 |
| `GET /api/v1/bookings/:id` (owner) | Bearer | 200 + nested centre/test | 401/403/404 |
| `POST /api/v1/bookings/:id/cancel` (owner) | Bearer | 200 CANCELLED | 401/403/404/409 |
| `POST /api/v1/payments` `{bookingId,simulate?,idempotencyKey?}` + optional `Idempotency-Key` header | Bearer | 201 payment (200 on idempotent replay) | 401/403/404/409/422 |
| `GET /api/v1/payments/:id` (owner) | Bearer | 200 payment | 401/403/404 |
| `POST /api/v1/payments/webhook` `{eventId,paymentId?\|providerTxnId?\|bookingId?,status}` | no (rate-limited 100/min/IP) | 200 `{ok:true,deduped:false}`; replay → `{ok:true,deduped:true}` | 404 unknown ref, 422 malformed |
| `GET /health` | no | 200 `{ok:true}` | — |
| `GET /api-docs` (+ `/api-docs.json`) | no | Swagger UI | — |

All errors use the envelope `{error:{code,message,details?}}`
(`VALIDATION_ERROR` 422, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
`CONFLICT…` 409, `RATE_LIMITED` 429).

### curl examples

```bash
# signup + keep token
TOKEN=$(curl -s localhost:3000/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"Asha","email":"asha@example.com","password":"Password123!"}' | node -p "JSON.parse(require('fs').readFileSync(0)).token")

# centre + test + booking
CENTRE=$(curl -s localhost:3000/api/v1/centres -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Apollo","location":"Bengaluru"}')
CID=$(echo $CENTRE | node -p "JSON.parse(require('fs').readFileSync(0)).id")
TID=$(curl -s localhost:3000/api/v1/centres/$CID/tests -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"CBC","price":299.5}' | node -p "JSON.parse(require('fs').readFileSync(0)).id")
BID=$(curl -s localhost:3000/api/v1/bookings -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"centreId\":\"$CID\",\"testId\":\"$TID\",\"appointmentAt\":\"2030-01-01T10:00:00.000Z\"}" | node -p "JSON.parse(require('fs').readFileSync(0)).id")

# pay (deterministic in tests via simulate; header key makes retries safe)
curl -s localhost:3000/api/v1/payments -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: order-123' \
  -d "{\"bookingId\":\"$BID\",\"simulate\":\"SUCCESS\"}"; echo

# provider webhook (public; replaying eventId is a no-op deduped:true)
curl -s localhost:3000/api/v1/payments/webhook -H 'Content-Type: application/json' \
  -d "{\"eventId\":\"evt-1\",\"bookingId\":\"$BID\",\"status\":\"SUCCESS\"}"; echo
curl -s localhost:3000/api/v1/payments/webhook -H 'Content-Type: application/json' \
  -d "{\"eventId\":\"evt-1\",\"bookingId\":\"$BID\",\"status\":\"SUCCESS\"}"; echo
```

## Schema (ER)

```
User 1───* Booking *───1 Centre 1───* DiagnosticTest
              │ 1                    │ 1
              │                      │  (* bookings reference a test of the same centre)
              │ 1                    └ remark: test.centreId must equal booking.centreId
              │
              └─1 Payment (bookingId UNIQUE, providerTxnId UNIQUE, idempotencyKey UNIQUE?)
WebhookEvent (eventId PK, paymentId?, bookingId?, status, payload JSON, receivedAt, processedAt?, deduped)
```

- `Booking.amount` snapshots the test price at booking time; later price edits don't affect existing bookings.
- `Booking.status`: `PENDING → CONFIRMED` (SUCCESS) / `PENDING → FAILED` (FAILED) / `PENDING|CONFIRMED → CANCELLED`; `CANCELLED`/`FAILED` are terminal for cancel; a `FAILED` booking may still reach `CONFIRMED` via a successful payment retry.
- `Payment.bookingId` is `UNIQUE`: at most one row per booking; a retry after `FAILED` re-charges into the same row. A second charge on a `SUCCESS`-paid/`CONFIRMED` booking → `409 PAYMENT_ALREADY_EXISTS`.
- `WebhookEvent.eventId` is the provider's idempotency key (`PRIMARY KEY`).

## Payments & webhook design (Agent-4)

- `mockGateway.charge({amount, simulate})` — no network; `simulate` wins after 50–150 ms, otherwise 80% `SUCCESS`. Returns `{providerTxnId (uuid), status}`.
- `POST /payments`: owner + terminal guards run **before** charging (no double charge); `Idempotency-Key` header (or `idempotencyKey` body) replays return the **same** payment with 200 and never re-charge; concurrent same-key races collapse via the DB `UNIQUE` (`P2002` → return winner).
- `POST /payments/webhook`: **claim-first** insert of `eventId`; `P2002` (or an already-processed row) → `{ok:true, deduped:true}` with zero side-effects. Payment resolved by `paymentId → providerTxnId → bookingId` (a booking-only event materialises the missing payment row; unknown refs → 404 with the placeholder removed, never a phantom payment). Terminal-safe apply: `CONFIRMED` is never flipped by a late `FAILED`; `CANCELLED` never moves. Downstream failures return `200 {ok:true, retryable:true}` — never a 500 retry loop. Malformed → 422.
- Structured pino logs on every step (`payment.created/gateway_result/idempotent_replay/retried`, `webhook.received/processed/deduped/terminal_noop/retryable_error`); passwords/tokens never logged.
- Rate limits: auth `POST /auth/*` 20/15 min/IP; `POST /payments` 30/min/user; webhook 100/min/IP → `429 {error:{code:'RATE_LIMITED'}}`.

## Background jobs (BullMQ + Redis)

Transient webhook apply-failures are retried by a worker, not just by the
provider re-posting: `handleWebhook()` enqueues `webhook-retries`
(`jobId === eventId`, 5 attempts, exponential backoff from 2 s) and
`src/workers/webhook.worker.js` re-runs the terminal-safe apply, which
no-ops on already-settled rows — so retries are idempotent. The queue is
best-effort: if Redis is down the webhook still returns
`200 {retryable:true}` and the provider retry applies it.

```bash
npm run worker   # standalone worker (or runs in-process with npm start)
```

## Assumptions

- Write APIs require auth; the webhook is intentionally public but rate-limited (real providers can't hold user JWTs; HMAC verification would be the next step).
- `amount` is a price snapshot, not a live join — refunds/prorations are out of scope.
- `simulate` is a test/demo lever, honoured verbatim by the mock gateway.
- Redis is a best-effort cache (60 s TTL, graceful DB fallback); payments/webhook correctness never depends on it.
- `GET /centres/:id` (and similar) map malformed ids to 404, never 500.

## Improvements with more time

- Webhook authenticity: HMAC signature header + timestamp tolerance, replay-window enforcement.
- Persistent idempotency ledger (TTL'd) instead of piggy-backing the payment row, incl. cross-user key isolation tests.
- Decimal-safe money math (minor units integer) + currency field.
- Outbox pattern for booking transitions; Prometheus metrics; request-id propagation in logs.
- Optimistic concurrency on bookings (`version` column) for double-spend races under real gateways.

## Note (fixed test defect)

`tests/integration/payments.webhook.test.js` originally declared
`let centre, test;` at module scope, which shadowed Jest's global `test()`
(collection failed with `TypeError: test is not a function`). Fixed 2026-10-01
by renaming the catalog variable to `diagTest` (3 refs, no assertion changed) —
the suite now runs its 17 cases green. `node scripts/smoke-payments.js` remains
as an extra standalone mirror of those scenarios.
