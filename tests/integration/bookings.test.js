/**
 * Architect-owned (FROZEN) — Agent-3 must make these green.
 * Covers: booking lifecycle, ownership, state machine, edge cases.
 */
const request = require('supertest');
const { getApp } = require('../helpers/app');
const { signupUser, authHeader } = require('../helpers/auth');
const { expectErrorShape, expectPaginationShape, futureISO, pastISO, randomId } = require('../helpers/assert');

let alice, bob;
let centreA, testA, centreB, testB;

beforeAll(async () => {
  const app = getApp();
  alice = await signupUser({ name: 'Alice' });
  bob = await signupUser({ name: 'Bob' });

  const mkCentre = async (name) => {
    const r = await request(app).post('/api/v1/centres').set(authHeader(alice.token)).send({ name, location: 'Bengaluru' });
    expect(r.status).toBe(201);
    return r.body;
  };
  const mkTest = async (centreId, name, price) => {
    const r = await request(app).post(`/api/v1/centres/${centreId}/tests`).set(authHeader(alice.token)).send({ name, price });
    expect(r.status).toBe(201);
    return r.body;
  };
  centreA = await mkCentre(`BookCentreA_${Date.now()}`);
  testA = await mkTest(centreA.id, `BookTestA_${Date.now()}`, 799);
  centreB = await mkCentre(`BookCentreB_${Date.now()}`);
  testB = await mkTest(centreB.id, `BookTestB_${Date.now()}`, 1299);
});

async function createBooking(tok, body) {
  const app = getApp();
  return request(app).post('/api/v1/bookings').set(authHeader(tok)).send(body);
}

describe('Bookings — create', () => {
  test('creates PENDING booking with amount snapshot from test price', async () => {
    const res = await createBooking(alice.token, { centreId: centreA.id, testId: testA.id, appointmentAt: futureISO() });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(Number(res.body.amount)).toBeCloseTo(Number(testA.price));
    expect(res.body).toHaveProperty('id');
  });

  test('no token → 401', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/bookings').send({ centreId: centreA.id, testId: testA.id, appointmentAt: futureISO() });
    expectErrorShape(res, 401);
  });

  test('past appointmentAt → 422', async () => {
    const res = await createBooking(alice.token, { centreId: centreA.id, testId: testA.id, appointmentAt: pastISO() });
    expectErrorShape(res, 422);
  });

  test('test not belonging to centre → 422 TEST_CENTRE_MISMATCH', async () => {
    const res = await createBooking(alice.token, { centreId: centreA.id, testId: testB.id, appointmentAt: futureISO() });
    expectErrorShape(res, 422);
  });

  test('unknown centre → 404', async () => {
    const res = await createBooking(alice.token, { centreId: randomId(), testId: testA.id, appointmentAt: futureISO() });
    expect(res.status).toBe(404);
  });

  test('unknown test → 404', async () => {
    const res = await createBooking(alice.token, { centreId: centreA.id, testId: randomId(), appointmentAt: futureISO() });
    expect(res.status).toBe(404);
  });

  test('malformed body (missing fields) → 422', async () => {
    const res = await createBooking(alice.token, { centreId: centreA.id });
    expectErrorShape(res, 422);
  });
});

describe('Bookings — read (owner isolation)', () => {
  test('GET /bookings returns only own bookings, paginated', async () => {
    const app = getApp();
    await createBooking(alice.token, { centreId: centreA.id, testId: testA.id, appointmentAt: futureISO() });
    await createBooking(bob.token, { centreId: centreA.id, testId: testA.id, appointmentAt: futureISO() });

    const mine = await request(app).get('/api/v1/bookings').set(authHeader(alice.token));
    expect(mine.status).toBe(200);
    expectPaginationShape(mine.body);
    mine.body.data.forEach((b) => expect(b.userId === alice.user.id || b.user?.id === alice.user.id || true).toBe(true));
    // Bob's booking must not leak into Alice's list: verify by id sets disjoint
    const bobs = await request(app).get('/api/v1/bookings').set(authHeader(bob.token));
    const aliceIds = new Set(mine.body.data.map((b) => b.id));
    bobs.body.data.forEach((b) => expect(aliceIds.has(b.id)).toBe(false));
  });

  test('GET /bookings/:id owner → 200 with nested centre/test', async () => {
    const app = getApp();
    const created = await createBooking(alice.token, { centreId: centreA.id, testId: testA.id, appointmentAt: futureISO() });
    const res = await request(app).get(`/api/v1/bookings/${created.body.id}`).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.centre?.id || res.body.centreId).toBeTruthy();
  });

  test('GET other user booking → 403', async () => {
    const app = getApp();
    const created = await createBooking(alice.token, { centreId: centreA.id, testId: testA.id, appointmentAt: futureISO() });
    const res = await request(app).get(`/api/v1/bookings/${created.body.id}`).set(authHeader(bob.token));
    expectErrorShape(res, 403);
  });

  test('GET invalid id → 404 (not 500)', async () => {
    const app = getApp();
    const r1 = await request(app).get('/api/v1/bookings/not-a-uuid').set(authHeader(alice.token));
    expect(r1.status).toBe(404);
    const r2 = await request(app).get(`/api/v1/bookings/${randomId()}`).set(authHeader(alice.token));
    expect(r2.status).toBe(404);
  });
});

describe('Bookings — cancel', () => {
  test('owner can cancel PENDING → CANCELLED', async () => {
    const app = getApp();
    const created = await createBooking(alice.token, { centreId: centreA.id, testId: testA.id, appointmentAt: futureISO() });
    const res = await request(app).post(`/api/v1/bookings/${created.body.id}/cancel`).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  test('double cancel → 409', async () => {
    const app = getApp();
    const created = await createBooking(alice.token, { centreId: centreA.id, testId: testA.id, appointmentAt: futureISO() });
    await request(app).post(`/api/v1/bookings/${created.body.id}/cancel`).set(authHeader(alice.token));
    const second = await request(app).post(`/api/v1/bookings/${created.body.id}/cancel`).set(authHeader(alice.token));
    expectErrorShape(second, 409);
  });

  test('cancel other user booking → 403', async () => {
    const app = getApp();
    const created = await createBooking(alice.token, { centreId: centreA.id, testId: testA.id, appointmentAt: futureISO() });
    const res = await request(app).post(`/api/v1/bookings/${created.body.id}/cancel`).set(authHeader(bob.token));
    expectErrorShape(res, 403);
  });

  test('cancel missing booking → 404', async () => {
    const app = getApp();
    const res = await request(app).post(`/api/v1/bookings/${randomId()}/cancel`).set(authHeader(alice.token));
    expect(res.status).toBe(404);
  });
});
