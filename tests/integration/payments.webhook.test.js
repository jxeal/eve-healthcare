/**
 * Architect-owned (FROZEN) — Agent-4 must make these green.
 * Covers: simulated payments, booking linkage, idempotency-key reuse,
 * webhook idempotency (incl. concurrent duplicates), retry-safety, edge cases.
 */
const request = require('supertest');
const { getApp } = require('../helpers/app');
const { signupUser, authHeader } = require('../helpers/auth');
const { expectErrorShape, futureISO, randomId } = require('../helpers/assert');

let alice, bob;
let centre, diagTest;

const evt = (suffix = '') => `evt_${Date.now()}_${Math.floor(Math.random() * 1e9)}${suffix}`;
const idem = () => `idem_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

beforeAll(async () => {
  const app = getApp();
  alice = await signupUser({ name: 'Pay Alice' });
  bob = await signupUser({ name: 'Pay Bob' });
  const c = await request(app).post('/api/v1/centres').set(authHeader(alice.token)).send({ name: `PayCentre_${Date.now()}`, location: 'Pune' });
  expect(c.status).toBe(201);
  centre = c.body;
  const t = await request(app).post(`/api/v1/centres/${centre.id}/tests`).set(authHeader(alice.token)).send({ name: `PayTest_${Date.now()}`, price: 999 });
  expect(t.status).toBe(201);
  diagTest = t.body;
});

async function makeBooking(tok = alice.token) {
  const app = getApp();
  const r = await request(app).post('/api/v1/bookings').set(authHeader(tok)).send({ centreId: centre.id, testId: diagTest.id, appointmentAt: futureISO() });
  expect(r.status).toBe(201);
  return r.body;
}

async function getBooking(tok, id) {
  const app = getApp();
  return request(app).get(`/api/v1/bookings/${id}`).set(authHeader(tok));
}

describe('Simulated payments — POST /api/v1/payments', () => {
  test('SUCCESS payment → 201 and booking becomes CONFIRMED', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const res = await request(app).post('/api/v1/payments').set(authHeader(alice.token)).send({ bookingId: booking.id, simulate: 'SUCCESS' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.status).toBe('SUCCESS');

    const b = await getBooking(alice.token, booking.id);
    expect(b.body.status).toBe('CONFIRMED');
  });

  test('FAILED payment → booking becomes FAILED', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const res = await request(app).post('/api/v1/payments').set(authHeader(alice.token)).send({ bookingId: booking.id, simulate: 'FAILED' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.status).toBe('FAILED');

    const b = await getBooking(alice.token, booking.id);
    expect(b.body.status).toBe('FAILED');
  });

  test('no token → 401', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/payments').send({ bookingId: randomId() });
    expectErrorShape(res, 401);
  });

  test("paying another user's booking → 403", async () => {
    const app = getApp();
    const booking = await makeBooking(alice.token);
    const res = await request(app).post('/api/v1/payments').set(authHeader(bob.token)).send({ bookingId: booking.id, simulate: 'SUCCESS' });
    expectErrorShape(res, 403);
  });

  test('unknown bookingId → 404', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/payments').set(authHeader(alice.token)).send({ bookingId: randomId(), simulate: 'SUCCESS' });
    expect(res.status).toBe(404);
  });

  test('double payment on CONFIRMED booking → 409 (no double charge)', async () => {
    const app = getApp();
    const booking = await makeBooking();
    await request(app).post('/api/v1/payments').set(authHeader(alice.token)).send({ bookingId: booking.id, simulate: 'SUCCESS' });
    const second = await request(app).post('/api/v1/payments').set(authHeader(alice.token)).send({ bookingId: booking.id, simulate: 'SUCCESS' });
    expectErrorShape(second, 409);
  });

  test('payment on CANCELLED booking → 409', async () => {
    const app = getApp();
    const booking = await makeBooking();
    await request(app).post(`/api/v1/bookings/${booking.id}/cancel`).set(authHeader(alice.token));
    const res = await request(app).post('/api/v1/payments').set(authHeader(alice.token)).send({ bookingId: booking.id, simulate: 'SUCCESS' });
    expectErrorShape(res, 409);
  });

  test('same Idempotency-Key returns SAME payment (no duplicate)', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const key = idem();
    const r1 = await request(app).post('/api/v1/payments').set(authHeader(alice.token)).set('Idempotency-Key', key).send({ bookingId: booking.id, simulate: 'SUCCESS' });
    expect([200, 201]).toContain(r1.status);
    // Second booking would 409 anyway; instead verify header path returns identical payment for SAME booking when key reused pre-terminal?
    // If implementation treats paid-booking as 409 even with same key, accept either same-id replay or 409 — but never a second payment row.
    const r2 = await request(app).post('/api/v1/payments').set(authHeader(alice.token)).set('Idempotency-Key', key).send({ bookingId: booking.id, simulate: 'SUCCESS' });
    if (r2.status === 409) return; // acceptable: terminal guard wins
    expect(r2.body.id).toBe(r1.body.id);
  });

  test('GET /payments/:id owner → 200; other user → 403; missing → 404', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const pay = await request(app).post('/api/v1/payments').set(authHeader(alice.token)).send({ bookingId: booking.id, simulate: 'SUCCESS' });
    const pid = pay.body.id;

    const own = await request(app).get(`/api/v1/payments/${pid}`).set(authHeader(alice.token));
    expect(own.status).toBe(200);

    const other = await request(app).get(`/api/v1/payments/${pid}`).set(authHeader(bob.token));
    expectErrorShape(other, 403);

    const missing = await request(app).get(`/api/v1/payments/${randomId()}`).set(authHeader(alice.token));
    expect(missing.status).toBe(404);
  });
});

describe('Webhook — POST /api/v1/payments/webhook (idempotent)', () => {
  test('webhook SUCCESS drives PENDING → CONFIRMED', async () => {
    const app = getApp();
    const booking = await makeBooking();
    // create a PENDING payment row first via FAILED-free path? Use webhook directly against booking ref:
    const res = await request(app).post('/api/v1/payments/webhook').send({ eventId: evt(), bookingId: booking.id, status: 'SUCCESS' });
    expect(res.status).toBe(200);
    expect(res.body.deduped).toBe(false);

    const b = await getBooking(alice.token, booking.id);
    expect(b.body.status).toBe('CONFIRMED');
  });

  test('webhook FAILED drives PENDING → FAILED', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const res = await request(app).post('/api/v1/payments/webhook').send({ eventId: evt(), bookingId: booking.id, status: 'FAILED' });
    expect(res.status).toBe(200);
    const b = await getBooking(alice.token, booking.id);
    expect(b.body.status).toBe('FAILED');
  });

  test('duplicate eventId → deduped:true with ZERO state change', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const eventId = evt();
    const first = await request(app).post('/api/v1/payments/webhook').send({ eventId, bookingId: booking.id, status: 'SUCCESS' });
    expect(first.status).toBe(200);
    const afterFirst = await getBooking(alice.token, booking.id);

    const second = await request(app).post('/api/v1/payments/webhook').send({ eventId, bookingId: booking.id, status: 'SUCCESS' });
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);

    const afterSecond = await getBooking(alice.token, booking.id);
    expect(afterSecond.body.status).toBe(afterFirst.body.status);
    expect(afterSecond.body.updatedAt || afterSecond.body.status).toEqual(afterFirst.body.updatedAt || afterFirst.body.status);
  });

  test('concurrent duplicate webhooks: both 200, single processing', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const eventId = evt('_race');
    const payload = { eventId, bookingId: booking.id, status: 'SUCCESS' };
    const [r1, r2] = await Promise.all([
      request(app).post('/api/v1/payments/webhook').send(payload),
      request(app).post('/api/v1/payments/webhook').send(payload),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const dedupedCount = [r1.body.deduped, r2.body.deduped].filter(Boolean).length;
    expect(dedupedCount).toBeGreaterThanOrEqual(1);
    const b = await getBooking(alice.token, booking.id);
    expect(b.body.status).toBe('CONFIRMED');
  });

  test('webhook missing eventId → 422', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const res = await request(app).post('/api/v1/payments/webhook').send({ bookingId: booking.id, status: 'SUCCESS' });
    expectErrorShape(res, 422);
  });

  test('webhook invalid status → 422', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/payments/webhook').send({ eventId: evt(), bookingId: (await makeBooking()).id, status: 'WEIRD' });
    expectErrorShape(res, 422);
  });

  test('webhook unknown booking ref → 404 (no phantom payment)', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/payments/webhook').send({ eventId: evt(), bookingId: randomId(), status: 'SUCCESS' });
    expect(res.status).toBe(404);
  });

  test('webhook replay with conflicting status does NOT flip terminal booking', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const firstId = evt('_a');
    await request(app).post('/api/v1/payments/webhook').send({ eventId: firstId, bookingId: booking.id, status: 'SUCCESS' });
    // A *different* event claiming FAILED afterwards must not corrupt CONFIRMED (terminal guard: second payment 409-style → stays CONFIRMED)
    const late = await request(app).post('/api/v1/payments/webhook').send({ eventId: evt('_b'), bookingId: booking.id, status: 'FAILED' });
    expect([200, 409]).toContain(late.status);
    const b = await getBooking(alice.token, booking.id);
    expect(b.body.status).toBe('CONFIRMED');
  });
});
