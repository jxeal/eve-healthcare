# EVE Healthcare — 4-Agent Build Plan (Express.js)

> **Architect-owned, FROZEN.** Agents implement source code to make `tests/` green.
> Do NOT modify `tests/`, `package.json` test scripts, or `jest.config.js` without architect approval.
> Stack: Node 20 + Express 5 + Prisma + PostgreSQL 16 + Redis (`ioredis`) + JWT + `zod` + `pino` + `express-rate-limit` + `swagger-ui-express` + `jest` + `supertest`.

Original assignment: `EVE_SDE_Intern_Hiring_Assignment_20260925_145951.pdf` (diagnostic bookings + simulated payments + idempotent webhook).

---

## 0. Frozen Contracts (all agents MUST respect — enables parallel work)

### 0.1 Project layout (Agent-1 scaffolds, others fill owned dirs)

```
eve-healthcare/
├── prisma/schema.prisma
├── src/
│   ├── app.js                  # A1: exports express app (NO app.listen here)
│   ├── server.js               # A1: listen entry (imports app.js)
│   ├── config/{index.js,db.js,redis.js}            # A1
│   ├── middlewares/{auth.js,validate.js,errorHandler.js,rateLimit.js,requestLogger.js} # A1
│   ├── utils/{jwt.js,password.js,errors.js,logger.js,pagination.js,idempotency.js}     # A1
│   ├── modules/
│   │   ├── auth/{auth.routes.js,auth.controller.js,auth.service.js,auth.schemas.js}    # A1
│   │   ├── centres/{centres.routes.js,centres.controller.js,centres.service.js,centres.schemas.js} # A2
│   │   ├── tests-catalog/{catalog.routes.js,catalog.controller.js,catalog.service.js,catalog.schemas.js} # A2 (mount under /centres/:id/tests + /tests)
│   │   ├── bookings/{bookings.routes.js,bookings.controller.js,bookings.service.js,bookings.schemas.js} # A3
│   │   └── payments/{payments.routes.js,payments.controller.js,payments.service.js,payments.schemas.js,webhook.service.js,mockGateway.js} # A4
│   └── docs/swagger.js         # A4
├── tests/                      # FROZEN (architect-owned)
├── Dockerfile, docker-compose.yml  # A1 (base) + A4 (final polish)
├── package.json, jest.config.js    # FROZEN test infra (architect-owned)
├── .env.example                # A1
└── README.md                   # A4 (with inputs from A1–A3)
```

Route mounting (in `src/app.js`, owned by A1 — other agents only export routers):

```js
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/centres', centresRoutes);   // includes /:centreId/tests sub-routes
app.use('/api/v1/tests', catalogRoutes);      // flat ?centreId= listing (A2)
app.use('/api/v1/bookings', bookingsRoutes); // A3
app.use('/api/v1/payments', paymentsRoutes); // includes POST /webhook (A4)
app.get('/health', ...); app.use('/api-docs', ...); // A1 + A4
```

### 0.2 Database — `prisma/schema.prisma` (A1 owns, others may request changes via A1)

```prisma
model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  bookings     Booking[]
  payments     Payment[]  // optional back-relation if needed
}

model Centre {
  id        String           @id @default(uuid())
  name      String
  location  String
  address   String?
  phone     String?
  createdAt DateTime         @default(now())
  tests     DiagnosticTest[]
  bookings  Booking[]
}

model DiagnosticTest {
  id          String   @id @default(uuid())
  centreId    String
  centre      Centre   @relation(fields: [centreId], references: [id], onDelete: Cascade)
  name        String
  description String?
  price       Decimal  @db.Decimal(10, 2)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  bookings    Booking[]
  @@unique([centreId, name])
}

enum BookingStatus { PENDING CONFIRMED FAILED CANCELLED }
enum PaymentStatus { PENDING SUCCESS FAILED }

model Booking {
  id            String        @id @default(uuid())
  userId        String
  user          User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  centreId      String
  centre        Centre        @relation(fields: [centreId], references: [id])
  testId        String
  test          DiagnosticTest @relation(fields: [testId], references: [id])
  appointmentAt DateTime
  amount        Decimal       @db.Decimal(10, 2) // snapshot of test price at booking time
  status        BookingStatus @default(PENDING)
  createdAt     DateTime      @default(now())
  payment       Payment?
  @@index([userId])
}

model Payment {
  id             String        @id @default(uuid())
  bookingId      String        @unique
  booking        Booking       @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  amount         Decimal       @db.Decimal(10, 2)
  status         PaymentStatus @default(PENDING)
  providerTxnId  String        @unique @default(uuid())
  idempotencyKey String?       @unique
  createdAt      DateTime      @default(now())
}

model WebhookEvent {
  eventId     String   @id            // provider-supplied idempotency key
  paymentId   String?
  bookingId   String?
  status      String                 // SUCCESS | FAILED (raw provider status)
  payload     Json
  receivedAt  DateTime @default(now())
  processedAt DateTime?
  deduped     Boolean  @default(false)
}
```

Rules: `amount` snapshot from test price; `appointmentAt` must be future; `test.centreId === booking.centreId` else 422.

### 0.3 Booking state machine (A3 enforces, A4 drives via payments)

```
PENDING --(payment SUCCESS / webhook SUCCESS)--> CONFIRMED
PENDING --(payment FAILED  / webhook FAILED) --> FAILED
PENDING|CONFIRMED --(owner POST /bookings/:id/cancel)--> CANCELLED
CANCELLED, FAILED are terminal (no transitions out; second cancel → 409)
FAILED bookings may create a NEW payment retry (stays FAILED until SUCCESS); do NOT auto-revive to PENDING.
```

### 0.4 Auth contract

* `POST /api/v1/auth/signup {name,email,password}` → `201 {user:{id,name,email,createdAt}, token}`. Duplicate email → `409`. Bad input → `422`.
* `POST /api/v1/auth/login {email,password}` → `200 {user, token}`. Wrong creds → `401`.
* `GET /api/v1/auth/me` (Bearer) → `200 {user}`. No/invalid token → `401`.
* JWT: `jsonwebtoken.sign({sub:userId,email}, JWT_SECRET, {expiresIn:'1h'})`. `middlewares/auth.js` sets `req.user={id,email}` or 401.
* Passwords: `bcryptjs` hash(10), never return hash.

### 0.5 Endpoint reference (tests assert exactly these)

| Method & Path | Auth | Body / Query | Success | Errors |
|---|---|---|---|---|
| `POST /api/v1/auth/signup` | no | `{name,email,password>=6}` | 201 user+token | 409 dup, 422 invalid |
| `POST /api/v1/auth/login` | no | `{email,password}` | 200 user+token | 401 bad creds, 422 |
| `GET /api/v1/auth/me` | yes | – | 200 user | 401 |
| `GET /api/v1/centres?page&limit&search` | no | pagination+search | 200 `{data,pagination}` | – |
| `POST /api/v1/centres` | yes | `{name,location,address?,phone?}` | 201 centre | 401, 422 |
| `GET /api/v1/centres/:id` | no | – | 200 centre | 404 |
| `GET /api/v1/centres/:centreId/tests` | no | – | 200 `[{test}]` | 404 centre |
| `POST /api/v1/centres/:centreId/tests` | yes | `{name,price>0,description?,isActive?}` | 201 test | 401/404/409 dup-name/422 |
| `GET /api/v1/tests?centreId=&page&limit` | no | – | 200 `{data,pagination}` | – |
| `POST /api/v1/bookings` | yes | `{centreId,testId,appointmentAt ISO future}` | 201 booking PENDING + amount snapshot | 401/404/422 (past date, mismatch) |
| `GET /api/v1/bookings?page&limit` | yes | own only | 200 `{data,pagination}` | 401 |
| `GET /api/v1/bookings/:id` | yes | owner only | 200 booking | 401/403/404 |
| `POST /api/v1/bookings/:id/cancel` | yes | owner only | 200 CANCELLED | 401/403/404/409 |
| `POST /api/v1/payments` | yes | `{bookingId, simulate?: SUCCESS\|FAILED, idempotencyKey?}` + optional `Idempotency-Key` header | 201/200 payment; booking updated | 401/403/404/409 (already paid/cancelled) /422 |
| `GET /api/v1/payments/:id` | yes | owner only | 200 payment | 401/403/404 |
| `POST /api/v1/payments/webhook` | no (rate-limited) | `{eventId,paymentId?\|providerTxnId?\|bookingId?,status: SUCCESS\|FAILED}` | 200 `{ok:true,deduped:false}`; dup → `{ok:true,deduped:true}` | 404 unknown ref, 422 bad payload |
| `GET /health` | no | – | 200 `{ok:true}` | – |

### 0.6 Cross-cutting standards

* Error envelope (all errors): `{error:{code,message,details?}}`. Codes: `VALIDATION_ERROR(422), UNAUTHORIZED(401), FORBIDDEN(403), NOT_FOUND(404), CONFLICT(409), RATE_LIMITED(429)`.
* Validation via `zod` in `*.schemas.js` + `middlewares/validate.js` → 422 on fail.
* Pagination helper `utils/pagination.js`: `parsePagination(query)` defaults `page=1,limit=10,max 100`; response `{data,pagination:{page,limit,total,totalPages}}`.
* Logging: `pino` + `pino-http` (`utils/logger.js`, `middlewares/requestLogger.js`), JSON logs, never log passwords/tokens.
* Rate limits (`middlewares/rateLimit.js`, owned A1, tuned A4): auth `POST /auth/*` 20/15min/IP; `POST /payments` 30/min/user; `POST /payments/webhook` 100/min/IP. Exceeded → `429 {error:{code:'RATE_LIMITED'}}`.
* Caching (A2 implements, A1 provides `config/redis.js`): `GET /centres`, `GET /centres/:id`, `GET .../tests`, `GET /tests` cache-aside 60s, invalidate on POST. Must degrade gracefully if Redis down (fall through to DB).
* Swagger (A4): `GET /api-docs` via `swagger-jsdoc`+`swagger-ui-express`, auto-generated from JSDoc + schemas.

---

## 1. Agent-1 — Foundation + Auth + Infra

**Owns:** `prisma/*, src/app.js, src/server.js, src/config/*, src/middlewares/*, src/utils/*, src/modules/auth/*, .env.example, Dockerfile, docker-compose.yml (base).`
**Must NOT touch:** `src/modules/{centres,tests-catalog,bookings,payments}/*`, `tests/*`.

Tasks:
1. `npm init`, deps: `express zod jsonwebtoken bcryptjs @prisma/client ioredis pino pino-http express-rate-limit swagger-ui-express swagger-jsdoc cors dotenv helmet`; devDeps: `jest supertest prisma`.
2. `prisma/schema.prisma` exactly per §0.2 + migration; `src/config/db.js` (PrismaClient singleton), `src/config/redis.js` (ioredis w/ `enableOfflineQueue:false`, export null-safe client + `isRedisUp()`), `src/config/index.js` (env: PORT, DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_EXPIRES_IN).
3. `src/app.js`: helmet/cors/json/pino-http/rateLimit wiring + router mounts per §0.1 + 404 + `errorHandler.js`. Export `{app}` (and `createApp()` if needed). `server.js` only listens.
4. `utils`: `password.js` (hash/compare), `jwt.js` (sign/verify), `errors.js` (ApiError + helpers), `pagination.js`, `idempotency.js` (sha256 key normalizer), `logger.js`.
5. `middlewares`: `auth.js` (Bearer verify → `req.user`, 401 otherwise), `validate.js` (zod wrapper → 422 envelope), `errorHandler.js`, `rateLimit.js` (three limiters per §0.6), `requestLogger.js`.
6. Auth module (schemas/controller/service/routes) per §0.4. Signup: validate, 409 on dup, hash, create, sign token. Login: find, compare (timing-safe message `Invalid credentials`), sign. `GET /me`.
7. `.env.example`, `Dockerfile` (node:20-alpine, prisma generate+ migrate deploy), `docker-compose.yml` (api/postgres:16/redis:7).
8. Definition of done: `tests/integration/auth.test.js` + `tests/unit/auth.*` green; `GET /health` 200; `npm run prisma:migrate` clean; Redis-down still serves requests.

## 2. Agent-2 — Centres & Diagnostic Tests Catalogue

**Owns:** `src/modules/centres/*, src/modules/tests-catalog/*, prisma/seed.js (optional).`
**Must NOT touch:** A1/A3/A4 dirs, `tests/*`. May request schema change via A1 only.

Tasks:
1. Schemas (`zod`): centre create `{name min2, location min2, address?, phone?}`; test create `{name min1, price positive number (accept string→number coercion), description?, isActive?}`.
2. `centres.service.js`: CRUD via Prisma; `listCentres({page,limit,search})` (search on name+location, case-insensitive); `getCentreById` (404 if missing); `createCentre`.
3. `catalog.service.js`: `listTestsByCentre(centreId)` (404 if centre missing), `createTest(centreId, data)` (404 centre / 409 dup name per `@@unique`), `listTestsFlat({centreId?,page,limit})`.
4. Controllers: correct status codes (201 create, 200 read), `{data,pagination}` envelope on lists, `{error}` envelope via `next(err)`.
5. Routes: `GET / + POST /` on centres; `GET /:id`; `GET /:centreId/tests + POST /:centreId/tests`; flat `GET /` on `/api/v1/tests`. Validate `:id` is uuid (invalid → 404, not 500). `POST` routes behind `auth.js`; `GET` public.
6. Redis cache-aside (60s TTL, key `eve:centres:list:...`, `eve:centre:<id>`, `eve:centre:<id>:tests`, `eve:tests:flat:...`); invalidate centre/test writes; wrap in try/catch so Redis outage → DB fallback (log warn, never 500).
7. Seed script with 3 centres × 2–3 tests (for local demo + manual QA).
8. Definition of done: `tests/integration/centres.tests.test.js` green incl. pagination shape, search, 404s, dup-name 409, cache-hit header/behavior, unauth POST 401.

## 3. Agent-3 — Booking System

**Owns:** `src/modules/bookings/*`. **Must NOT touch** other modules or `tests/*`.

Tasks:
1. Schemas: create `{centreId uuid, testId uuid, appointmentAt ISO-datetime future}`; strict unknown-field rejection.
2. `bookings.service.js`:
   * `createBooking(userId,{centreId,testId,appointmentAt})`: verify centre (404 `CENTRE_NOT_FOUND`), test (404 `TEST_NOT_FOUND`), test active else 422, `test.centreId===centreId` else 422 `TEST_CENTRE_MISMATCH`, appointment future else 422, snapshot `amount=test.price`, create `PENDING`.
   * `listBookings(userId,{page,limit})` owner-scoped, newest-first.
   * `getBookingById(userId,id)` 404 if missing, 403 if not owner.
   * `cancelBooking(userId,id)` 404/403 as above; 409 if already `CANCELLED/FAILED` (`BOOKING_NOT_CANCELLABLE`); `CONFIRMED` cancellable (per §0.3) — set `CANCELLED`. Invalid uuid → 404.
3. Controller/routes: `POST /`, `GET /`, `GET /:id`, `POST /:id/cancel`, all behind `auth.js`. Include nested `centre/test` summaries in GET responses (`include:{centre:true,test:true}`) as tests assert `booking.centre.id` / `booking.test.id`.
4. Enforce state machine §0.3 — service owns transitions; expose `applyPaymentResult(bookingId, 'SUCCESS'|'FAILED')` helper for A4 (idempotent: no-op if already terminal).
5. Definition of done: `tests/integration/bookings.test.js` green: snapshot amount, past-date 422, mismatch 422, own-only isolation, cancel rules, 401/403/404 matrix.

## 4. Agent-4 — Simulated Payments + Idempotent Webhook + Hardening/Docs

**Owns:** `src/modules/payments/*, src/docs/*, README.md`, final polish of `Dockerfile/compose`. **Must NOT touch** other modules or `tests/*` (except README/docs).

Tasks:
1. Schemas: `POST /payments {bookingId uuid, simulate?: 'SUCCESS'|'FAILED', idempotencyKey?}`; webhook `{eventId min1, paymentId?|providerTxnId?|bookingId? (≥1 required), status: SUCCESS|FAILED}`.
2. `mockGateway.js`: `charge({amount, simulate})` → deterministic: if `simulate` given return it after ~50–150ms delay; else random (`Math.random()<0.8 SUCCESS`). Returns `{providerTxnId: uuid, status}`. Never calls network.
3. `payments.service.js`:
   * `createPayment(userId,{bookingId,simulate,idempotencyKey|header})`: booking 404/403-owner-check; 409 if booking `CANCELLED` or already has SUCCESS payment (`PAYMENT_ALREADY_EXISTS`); idempotency: if key matches existing payment → return it (200, no new charge); else charge via gateway, create `Payment`, call A3 `applyPaymentResult`, return 201.
   * `getPaymentById(userId,id)` 404/403.
4. `webhook.service.js` (idempotent, retry-safe):
   * `handleWebhook({eventId,...})`: **upsert-first** `WebhookEvent` by `eventId` — if exists & processed → return `{deduped:true}` immediately (no state change). Else resolve payment (by paymentId/txn/bookingId; 404 if none), store event, apply result via A3 helper (terminal-state no-op), mark processed. Concurrent duplicates safe via DB UNIQUE + catch `P2002` → treat as deduped.
   * Never 500 on provider retry: catch downstream errors, leave event unprocessed but return 200 `{ok:true, retryable:true}` so provider retries; malformed → 422; unknown ref → 404.
5. Routes: `POST /payments` (auth), `GET /payments/:id` (auth+owner), `POST /payments/webhook` (public, webhook rate-limiter). Correct codes per §0.5.
6. Docs & DevOps: `src/docs/swagger.js` + `GET /api-docs`; tune rate limits; structured logs around payments/webhook (`orderId/eventId/status`); finalize `Dockerfile/compose` (healthchecks); write `README.md` (run locally, endpoints + curl examples, schema diagram, assumptions, improvements).
7. Definition of done: `tests/integration/payments.webhook.test.js` + `tests/unit/*` green: SUCCESS/FAILED flows, double-charge guard, idempotency-key reuse, webhook dup no-op, invalid/unknown/unauth matrix.

---

## 5. Ownership & merge order (avoid conflicts)

* No agent edits another's `src/modules/*` dir. Shared files (`src/app.js`, `prisma/schema.prisma`) are A1-only; others file requests in PR description.
* Merge order: A1 first (unblocks mounts) → A2+A3+A4 rebase on A1 → A4 last (docs). CI gate: `npm test` (all frozen tests) must pass.
* Env for local: copy `.env.example` → `.env`; `docker compose up -d postgres redis`; `npx prisma migrate dev`; `npm test`.

## 6. Test-first workflow (mandatory)

1. `npm ci && npm test` — observe red tests for your area.
2. Implement only your owned files until your area's tests go green.
3. `npm run lint` (if configured) + full `npm test` before PR. No test edits to make them pass — fix source.

**Frozen test inventory (~60 cases):**
* `tests/integration/auth.test.js` → Agent-1 (signup/login/me, 12 cases)
* `tests/integration/centres.tests.test.js` → Agent-2 (CRUD/pagination/search/cache, 14 cases)
* `tests/integration/bookings.test.js` → Agent-3 (lifecycle/ownership/cancel, 15 cases)
* `tests/integration/payments.webhook.test.js` → Agent-4 (payments/idempotency/webhook, 17 cases)
* `tests/unit/pagination.test.js` + `tests/unit/idempotency.test.js` + `tests/unit/authUtils.test.js` → Agent-1
* `tests/unit/bookingTransitions.test.js` → Agent-3 (state machine §0.3)
* `tests/helpers/{app,auth,assert}.js`, `tests/setup.js`, `jest.config.js` → architect-owned infra, do not edit.
* `jest.config.js` is the SOLE Jest config — `package.json` must NOT contain a `jest` key (Jest aborts with "Multiple configurations found" otherwise; fixed 2026-10-01).
* `tests/integration/payments.webhook.test.js`: module-scope variable renamed `test` → `diagTest` (2026-10-01) — the old name shadowed Jest's global `test()`, failing collection with `TypeError: test is not a function`.

## 7. Submission checklist (A4 assembles, all contribute notes)

* [ ] README: run steps, endpoint table + curl, schema/ER description, assumptions (e.g. write-APIs require auth; webhook unauthenticated but rate-limited; amount snapshot), improvements-with-more-time.
* [ ] `package.json` scripts: `dev/start/test/prisma:migrate/seed`; `Dockerfile` + `docker-compose.yml` boot cleanly.
* [ ] `GET /api-docs` renders; `GET /health` 200; logs JSON; pagination on all lists; rate-limit 429s.
