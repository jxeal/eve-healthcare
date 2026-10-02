# EVE Healthcare: diagnostic bookings and simulated payments

Node 20, Express 4, Prisma on PostgreSQL 16, Redis, BullMQ, JWT, zod and pino.

Patients book diagnostic tests at centres and pay through a simulated gateway. The payment
provider reports outcomes through a signed, idempotent webhook. Swagger UI is at `GET /api-docs`
and a health check at `GET /health`.

## Run locally

```bash
cp .env.example .env                  # set JWT_SECRET and WEBHOOK_SECRET
docker compose up -d postgres redis   # or your own Postgres 16 + Redis 7
npx prisma migrate deploy             # applies prisma/migrations
npm run seed                          # admin@eve.local / Admin@12345 + 3 centres with tests
npm run dev                           # http://localhost:3000
```

The webhook retry worker runs inside the API process. `npm run worker` starts it on its own if
you want to scale it separately.

### Tests

The suite needs Postgres and Redis. It uses its own database so it never touches dev data:

```bash
createdb eve_test
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/eve_test npx prisma migrate deploy
npm test                              # or DATABASE_URL_TEST=... npm test for another database
```

### Docker

```bash
JWT_SECRET=$(openssl rand -hex 32) WEBHOOK_SECRET=$(openssl rand -hex 32) docker compose up --build
```

Compose refuses to start without both secrets, and so does the app when `NODE_ENV=production`.
The container runs `prisma migrate deploy` before booting. It doesn't seed, so run
`docker compose exec api node prisma/seed.js` once to get an admin.

## Endpoints

All paths are under `/api/v1`. Errors always look like `{ "error": { "code", "message", "details?" } }`.

| Method and path | Auth | Success | Errors |
|---|---|---|---|
| `POST /auth/signup` `{name, email, password}` | none | 201 `{user, token}` | 409, 422, 429 |
| `POST /auth/login` `{email, password}` | none | 200 `{user, token}` | 401, 422, 429 |
| `GET /auth/me` | user | 200 `{user}` | 401 |
| `GET /centres?page&limit&search` | none | 200 `{data, pagination}` | |
| `POST /centres` | admin | 201 centre | 401, 403, 422 |
| `GET /centres/:id` | none | 200 centre | 404 |
| `PATCH /centres/:id` | admin | 200 centre | 403, 404, 422 |
| `GET /centres/:centreId/tests` | none | 200 active tests | 404 |
| `POST /centres/:centreId/tests` `{name, price, description?, isActive?}` | admin | 201 test | 403, 404, 409, 422 |
| `PATCH /centres/:centreId/tests/:testId` | admin | 200 test | 403, 404, 409, 422 |
| `GET /tests?centreId&page&limit` | none | 200 `{data, pagination}` | 422 |
| `POST /bookings` `{centreId, testId, appointmentAt}` | user | 201 booking (PENDING) | 404, 422 |
| `GET /bookings?page&limit` | user | 200 own bookings | 401 |
| `GET /bookings/:id` | owner | 200 booking with centre, test and payment attempts | 403, 404 |
| `POST /bookings/:id/cancel` | owner | 200 booking (CANCELLED) | 403, 404, 409 |
| `POST /payments` `{bookingId, simulate?}` + optional `Idempotency-Key` | owner | 201 payment, 200 on replay | 403, 404, 409, 422 |
| `GET /payments/:id` | owner | 200 payment | 403, 404 |
| `POST /payments/webhook` `{eventId, paymentId or providerTxnId, status}` | HMAC signature | 200 `{ok, deduped, applied}`, 202 when queued | 401, 404, 422, 503 |

Signup always creates a `USER`. Admins come from the seed script; promoting someone else means
setting `role = 'ADMIN'` in the database. The role travels in the JWT, so a promoted user has to log in again.

### Example session

```bash
API=localhost:3000/api/v1
json() { node -p "JSON.parse(require('fs').readFileSync(0)).$1"; }

ADMIN=$(curl -s $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@eve.local","password":"Admin@12345"}' | json token)
CID=$(curl -s $API/centres -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"Apollo","location":"Bengaluru"}' | json id)
TID=$(curl -s $API/centres/$CID/tests -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"CBC","price":299.5}' | json id)

TOKEN=$(curl -s $API/auth/signup -H 'Content-Type: application/json' \
  -d '{"name":"Asha","email":"asha@example.com","password":"Password123!"}' | json token)
BID=$(curl -s $API/bookings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"centreId\":\"$CID\",\"testId\":\"$TID\",\"appointmentAt\":\"2030-01-01T10:00:00Z\"}" | json id)

# Synchronous outcome: SUCCESS confirms the booking, FAILED marks it FAILED (and it can be paid again).
curl -s $API/payments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123' -d "{\"bookingId\":\"$BID\",\"simulate\":\"SUCCESS\"}"

# Asynchronous outcome: the payment stays PENDING until the provider's webhook arrives.
BID2=$(curl -s $API/bookings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"centreId\":\"$CID\",\"testId\":\"$TID\",\"appointmentAt\":\"2030-01-02T10:00:00Z\"}" | json id)
PID=$(curl -s $API/payments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"bookingId\":\"$BID2\",\"simulate\":\"PENDING\"}" | json id)
npm run webhook -- $PID SUCCESS evt-1   # signs with WEBHOOK_SECRET and posts
npm run webhook -- $PID SUCCESS evt-1   # same event again: {"deduped":true}
```

Without `simulate`, the mock gateway answers SUCCESS 80% of the time and FAILED otherwise.

## Schema

```
User 1──* Booking *──1 Centre 1──* DiagnosticTest
            │ (testId, centreId) ──> DiagnosticTest(id, centreId)
            │
            1──* Payment 1──* WebhookEvent
```

- **Booking** stores `amount` as a snapshot of the test price, so later price changes don't touch
  existing bookings. A composite foreign key on `(testId, centreId)` makes the database reject a
  booking whose test belongs to a different centre.
- **Payment** has one row per attempt, so a failed attempt and its successful retry both stay on
  record. A partial unique index (`Payment_bookingId_active_key`, raw SQL in the init migration)
  allows at most one PENDING or SUCCESS attempt per booking. `idempotencyKey` stores a SHA-256 of
  `userId:key`, which scopes keys per user.
- **WebhookEvent** uses the provider's `eventId` as its primary key and references the payment it
  settles. It records `processedAt`, `outcome` (APPLIED or IGNORED), `attempts` and `lastError`.
- Money is `DECIMAL(10,2)`. Every foreign key is `ON DELETE RESTRICT`, so deleting a user or
  centre can never cascade away payment records.

### Booking states

```
PENDING   ── payment SUCCESS ──> CONFIRMED
PENDING   ── payment FAILED  ──> FAILED
FAILED    ── payment SUCCESS ──> CONFIRMED      (retry)
PENDING | FAILED | CONFIRMED ── cancel ──> CANCELLED
```

`nextStatus()` in `bookings.service.js` holds this table and every status change goes through it.
Cancelling a CONFIRMED booking marks its payment REFUNDED (simulated).

## How payments stay consistent

Every operation that changes a booking takes a row lock on it first (`SELECT ... FOR UPDATE`):
creating a payment attempt, settling one, processing a webhook and cancelling.

`POST /payments` runs in three steps:

1. Under the lock, check ownership, replay an existing `Idempotency-Key`, refuse CANCELLED,
   CONFIRMED or in-progress bookings, and insert a PENDING attempt. Then commit.
2. Call the gateway outside any transaction.
3. Under the lock again, move the attempt to SUCCESS or FAILED and update the booking.

Concurrent requests for one booking queue on the lock, and all but the first get
`409 PAYMENT_IN_PROGRESS`. The gateway is charged once. Cancelling while an attempt is PENDING
returns `409 PAYMENT_IN_PROGRESS`, so a booking can't end up cancelled with a captured payment.

`POST /payments/webhook`:

1. Verifies `X-Webhook-Signature`, a hex HMAC-SHA256 of `"{X-Webhook-Timestamp}.{raw body}"`.
   Timestamps more than `WEBHOOK_TOLERANCE_SEC` (300) old are rejected.
2. Resolves the payment by `paymentId` or `providerTxnId`. An unknown reference returns 404 and
   stores nothing. A booking id alone is not accepted.
3. Inserts the event (`ON CONFLICT DO NOTHING`), then processes it in one transaction that locks
   the event row. A duplicate delivery waits on that lock, sees `processedAt` and returns
   `deduped: true`.
4. Only PENDING payments change. An event for a payment that has already settled is recorded with
   `outcome: IGNORED` and returns `applied: false`. A late FAILED never undoes a SUCCESS.
5. If processing throws, the transaction rolls back and the event stays unprocessed. The endpoint
   queues a BullMQ job and returns 202. The worker retries up to 5 times with exponential backoff
   from 2 s. If Redis is down too, the endpoint returns 503 so the provider redelivers, and a
   redelivery of an unprocessed event is processed rather than deduped.

## Other bonus pieces

- Redis caches centre and test reads for 60 s and degrades to the database when Redis is down.
  Writes invalidate the affected keys with `SCAN`, never `KEYS`.
- Rate limits: auth 20 per 15 min per IP, payments 30 per minute per user, webhook 100 per minute
  per IP. The `RATE_LIMIT_*` env vars override them, which the test suite uses.
- pino writes structured JSON logs (`payment.charged`, `webhook.processed`, `webhook.deduped`,
  `webhook.process_failed`, ...). Passwords and tokens are never logged.

## Assumptions

- The mock gateway answers synchronously unless `simulate: "PENDING"` asks it to behave like an
  asynchronous provider. That mode is what gives the webhook something to settle.
- A settled payment (SUCCESS, FAILED or REFUNDED) is final. A provider that changes its mind after
  the fact would need a reconciliation flow, which is out of scope.
- Tests are retired with `isActive: false` instead of deleted, because bookings reference them.
  Retired tests vanish from public lists and can't be booked.
- Appointment slots have no capacity limit. Any future time is bookable.
- Emails are case-insensitive and stored lowercase.

## What I would do with more time

- A reconciliation job for payments stuck in PENDING, for example when the process dies between
  charging and settling.
- Rotate webhook secrets (accept the old and new one during a window) and keep a ledger of
  processed provider transaction ids.
- Appointment slots with capacity per centre, so two people can't book the last slot.
- Money in integer minor units with a currency column.
- Request ids carried through logs, plus Prometheus metrics for queue depth and webhook latency.
- A real ESLint config in CI.
