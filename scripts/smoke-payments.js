'use strict';

/**
 * Agent-4 smoke test — 1:1 mirror of tests/integration/payments.webhook.test.js
 * (same scenarios, same assertions), runnable as plain Node.
 *
 * Why this exists: the FROZEN test file declares `let centre, test;` at
 * module scope, which lexically shadows Jest's global `test()` — so the
 * file cannot even be collected (`TypeError: test is not a function`).
 * tests/ is frozen, so this script replicates every one of its 17 cases
 * with the catalog variable renamed (`catalogTest`) to prove the
 * implementation satisfies the contract. Run: `node scripts/smoke-payments.js`
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'eve-test-secret-change-in-prod';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/eve_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../src/app');

const uniqueEmail = (prefix = 'user') =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}@example.com`;
const futureISO = (days = 7) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const randomId = () =>
  `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
const evt = (suffix = '') => `evt_${Date.now()}_${Math.floor(Math.random() * 1e9)}${suffix}`;
const idem = () => `idem_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok   - ${name}`);
    })
    .catch((err) => {
      console.error(`FAIL - ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`);
      process.exitCode = 1;
    });
}

function expectErrorShape(res, status) {
  assert.equal(res.status, status, `expected status ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body && res.body.error, 'missing error envelope');
  assert.ok(res.body.error.code, 'missing error.code');
  assert.ok(res.body.error.message, 'missing error.message');
}

async function signupUser(name) {
  const payload = { name, email: uniqueEmail(), password: 'Password123!' };
  const res = await request(app).post('/api/v1/auth/signup').send(payload);
  assert.equal(res.status, 201, `signup failed: ${JSON.stringify(res.body)}`);
  return { user: res.body.user, token: res.body.token };
}
const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

let alice;
let bob;
let centre;
let catalogTest;

async function makeBooking(tok) {
  const r = await request(app)
    .post('/api/v1/bookings')
    .set(authHeader(tok || alice.token))
    .send({ centreId: centre.id, testId: catalogTest.id, appointmentAt: futureISO() });
  assert.equal(r.status, 201, `makeBooking failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

async function getBooking(tok, id) {
  return request(app).get(`/api/v1/bookings/${id}`).set(authHeader(tok));
}

async function main() {
  alice = await signupUser('Pay Alice');
  bob = await signupUser('Pay Bob');

  const c = await request(app)
    .post('/api/v1/centres')
    .set(authHeader(alice.token))
    .send({ name: `PayCentre_${Date.now()}`, location: 'Pune' });
  assert.equal(c.status, 201, `centre setup failed: ${JSON.stringify(c.body)}`);
  centre = c.body;

  const t = await request(app)
    .post(`/api/v1/centres/${centre.id}/tests`)
    .set(authHeader(alice.token))
    .send({ name: `PayTest_${Date.now()}`, price: 999 });
  assert.equal(t.status, 201, `catalog-test setup failed: ${JSON.stringify(t.body)}`);
  catalogTest = t.body;

  // --- Simulated payments ---
  await check('SUCCESS payment → 201 and booking becomes CONFIRMED', async () => {
    const booking = await makeBooking();
    const res = await request(app)
      .post('/api/v1/payments')
      .set(authHeader(alice.token))
      .send({ bookingId: booking.id, simulate: 'SUCCESS' });
    assert.ok([200, 201].includes(res.status), `status ${res.status}`);
    assert.equal(res.body.status, 'SUCCESS');
    const b = await getBooking(alice.token, booking.id);
    assert.equal(b.body.status, 'CONFIRMED');
  });

  await check('FAILED payment → booking becomes FAILED', async () => {
    const booking = await makeBooking();
    const res = await request(app)
      .post('/api/v1/payments')
      .set(authHeader(alice.token))
      .send({ bookingId: booking.id, simulate: 'FAILED' });
    assert.ok([200, 201].includes(res.status), `status ${res.status}`);
    assert.equal(res.body.status, 'FAILED');
    const b = await getBooking(alice.token, booking.id);
    assert.equal(b.body.status, 'FAILED');
  });

  await check('no token → 401', async () => {
    const res = await request(app).post('/api/v1/payments').send({ bookingId: randomId() });
    expectErrorShape(res, 401);
  });

  await check("paying another user's booking → 403", async () => {
    const booking = await makeBooking(alice.token);
    const res = await request(app)
      .post('/api/v1/payments')
      .set(authHeader(bob.token))
      .send({ bookingId: booking.id, simulate: 'SUCCESS' });
    expectErrorShape(res, 403);
  });

  await check('unknown bookingId → 404', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set(authHeader(alice.token))
      .send({ bookingId: randomId(), simulate: 'SUCCESS' });
    assert.equal(res.status, 404);
  });

  await check('double payment on CONFIRMED booking → 409 (no double charge)', async () => {
    const booking = await makeBooking();
    await request(app)
      .post('/api/v1/payments')
      .set(authHeader(alice.token))
      .send({ bookingId: booking.id, simulate: 'SUCCESS' });
    const second = await request(app)
      .post('/api/v1/payments')
      .set(authHeader(alice.token))
      .send({ bookingId: booking.id, simulate: 'SUCCESS' });
    expectErrorShape(second, 409);
  });

  await check('payment on CANCELLED booking → 409', async () => {
    const booking = await makeBooking();
    await request(app).post(`/api/v1/bookings/${booking.id}/cancel`).set(authHeader(alice.token));
    const res = await request(app)
      .post('/api/v1/payments')
      .set(authHeader(alice.token))
      .send({ bookingId: booking.id, simulate: 'SUCCESS' });
    expectErrorShape(res, 409);
  });

  await check('same Idempotency-Key returns SAME payment (no duplicate)', async () => {
    const booking = await makeBooking();
    const key = idem();
    const r1 = await request(app)
      .post('/api/v1/payments')
      .set(authHeader(alice.token))
      .set('Idempotency-Key', key)
      .send({ bookingId: booking.id, simulate: 'SUCCESS' });
    assert.ok([200, 201].includes(r1.status), `r1 status ${r1.status}`);
    const r2 = await request(app)
      .post('/api/v1/payments')
      .set(authHeader(alice.token))
      .set('Idempotency-Key', key)
      .send({ bookingId: booking.id, simulate: 'SUCCESS' });
    if (r2.status === 409) return;
    assert.equal(r2.body.id, r1.body.id);
  });

  await check('GET /payments/:id owner → 200; other user → 403; missing → 404', async () => {
    const booking = await makeBooking();
    const pay = await request(app)
      .post('/api/v1/payments')
      .set(authHeader(alice.token))
      .send({ bookingId: booking.id, simulate: 'SUCCESS' });
    const pid = pay.body.id;

    const own = await request(app).get(`/api/v1/payments/${pid}`).set(authHeader(alice.token));
    assert.equal(own.status, 200);

    const other = await request(app).get(`/api/v1/payments/${pid}`).set(authHeader(bob.token));
    expectErrorShape(other, 403);

    const missing = await request(app)
      .get(`/api/v1/payments/${randomId()}`)
      .set(authHeader(alice.token));
    assert.equal(missing.status, 404);
  });

  // --- Webhook ---
  await check('webhook SUCCESS drives PENDING → CONFIRMED', async () => {
    const booking = await makeBooking();
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .send({ eventId: evt(), bookingId: booking.id, status: 'SUCCESS' });
    assert.equal(res.status, 200);
    assert.equal(res.body.deduped, false);
    const b = await getBooking(alice.token, booking.id);
    assert.equal(b.body.status, 'CONFIRMED');
  });

  await check('webhook FAILED drives PENDING → FAILED', async () => {
    const booking = await makeBooking();
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .send({ eventId: evt(), bookingId: booking.id, status: 'FAILED' });
    assert.equal(res.status, 200);
    const b = await getBooking(alice.token, booking.id);
    assert.equal(b.body.status, 'FAILED');
  });

  await check('duplicate eventId → deduped:true with ZERO state change', async () => {
    const booking = await makeBooking();
    const eventId = evt();
    const first = await request(app)
      .post('/api/v1/payments/webhook')
      .send({ eventId, bookingId: booking.id, status: 'SUCCESS' });
    assert.equal(first.status, 200);
    const afterFirst = await getBooking(alice.token, booking.id);

    const second = await request(app)
      .post('/api/v1/payments/webhook')
      .send({ eventId, bookingId: booking.id, status: 'SUCCESS' });
    assert.equal(second.status, 200);
    assert.equal(second.body.deduped, true);

    const afterSecond = await getBooking(alice.token, booking.id);
    assert.equal(afterSecond.body.status, afterFirst.body.status);
    assert.deepEqual(
      afterSecond.body.updatedAt || afterSecond.body.status,
      afterFirst.body.updatedAt || afterFirst.body.status
    );
  });

  await check('concurrent duplicate webhooks: both 200, single processing', async () => {
    const booking = await makeBooking();
    const eventId = evt('_race');
    const payload = { eventId, bookingId: booking.id, status: 'SUCCESS' };
    const [r1, r2] = await Promise.all([
      request(app).post('/api/v1/payments/webhook').send(payload),
      request(app).post('/api/v1/payments/webhook').send(payload),
    ]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const dedupedCount = [r1.body.deduped, r2.body.deduped].filter(Boolean).length;
    assert.ok(dedupedCount >= 1, `expected >=1 deduped, got ${JSON.stringify([r1.body, r2.body])}`);
    const b = await getBooking(alice.token, booking.id);
    assert.equal(b.body.status, 'CONFIRMED');
  });

  await check('webhook missing eventId → 422', async () => {
    const booking = await makeBooking();
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .send({ bookingId: booking.id, status: 'SUCCESS' });
    expectErrorShape(res, 422);
  });

  await check('webhook invalid status → 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .send({ eventId: evt(), bookingId: (await makeBooking()).id, status: 'WEIRD' });
    expectErrorShape(res, 422);
  });

  await check('webhook unknown booking ref → 404 (no phantom payment)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .send({ eventId: evt(), bookingId: randomId(), status: 'SUCCESS' });
    assert.equal(res.status, 404);
  });

  await check('webhook replay with conflicting status does NOT flip terminal booking', async () => {
    const booking = await makeBooking();
    const firstId = evt('_a');
    await request(app)
      .post('/api/v1/payments/webhook')
      .send({ eventId: firstId, bookingId: booking.id, status: 'SUCCESS' });
    const late = await request(app)
      .post('/api/v1/payments/webhook')
      .send({ eventId: evt('_b'), bookingId: booking.id, status: 'FAILED' });
    assert.ok([200, 409].includes(late.status), `late status ${late.status}`);
    const b = await getBooking(alice.token, booking.id);
    assert.equal(b.body.status, 'CONFIRMED');
  });

  console.log(`\n${passed}/17 smoke checks passed`);
}

main().catch((err) => {
  console.error(`FATAL: ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
});
