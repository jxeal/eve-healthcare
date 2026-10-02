const request = require('supertest');
const { getApp } = require('../helpers/app');
const { signupUser, createAdmin, authHeader } = require('../helpers/auth');
const { expectErrorShape, futureISO, randomId } = require('../helpers/assert');
const { createCentreWithTest } = require('../helpers/catalog');
const { postWebhook, eventId } = require('../helpers/webhook');
const { prisma } = require('../../src/config/db');
const gateway = require('../../src/modules/payments/mockGateway');
const paymentsService = require('../../src/modules/payments/payments.service');
const webhookService = require('../../src/modules/payments/webhook.service');
const queue = require('../../src/queue/webhook.queue');

let alice;
let bob;
let centre;
let diagTest;

const idemKey = () => `idem_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

beforeAll(async () => {
  alice = await signupUser({ name: 'Pay Alice' });
  bob = await signupUser({ name: 'Pay Bob' });
  const { token } = await createAdmin();
  ({ centre, test: diagTest } = await createCentreWithTest(token, { price: 999 }));
});

afterEach(() => jest.restoreAllMocks());

async function makeBooking(tok = alice.token) {
  const r = await request(getApp())
    .post('/api/v1/bookings')
    .set(authHeader(tok))
    .send({ centreId: centre.id, testId: diagTest.id, appointmentAt: futureISO() });
  expect(r.status).toBe(201);
  return r.body;
}

function pay(bookingId, { simulate, key, tok = alice.token } = {}) {
  const req = request(getApp()).post('/api/v1/payments').set(authHeader(tok));
  if (key) req.set('Idempotency-Key', key);
  return req.send({ bookingId, ...(simulate ? { simulate } : {}) });
}

const cancel = (bookingId, tok = alice.token) =>
  request(getApp()).post(`/api/v1/bookings/${bookingId}/cancel`).set(authHeader(tok));

const bookingRow = (id) => prisma.booking.findUnique({ where: { id }, include: { payments: true } });

async function pendingPayment() {
  const booking = await makeBooking();
  const res = await pay(booking.id, { simulate: 'PENDING' });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('PENDING');
  return { booking, payment: res.body };
}

describe('Simulated payments — POST /api/v1/payments', () => {
  test('SUCCESS payment → 201 and booking becomes CONFIRMED', async () => {
    const booking = await makeBooking();
    const res = await pay(booking.id, { simulate: 'SUCCESS' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'SUCCESS', bookingId: booking.id, providerTxnId: expect.any(String) });
    expect(res.body).not.toHaveProperty('idempotencyKey');
    expect((await bookingRow(booking.id)).status).toBe('CONFIRMED');
  });

  test('FAILED payment → booking becomes FAILED', async () => {
    const booking = await makeBooking();
    const res = await pay(booking.id, { simulate: 'FAILED' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('FAILED');
    expect((await bookingRow(booking.id)).status).toBe('FAILED');
  });

  test('retry after FAILED is a new attempt; history is kept', async () => {
    const booking = await makeBooking();
    const failed = await pay(booking.id, { simulate: 'FAILED' });
    const retry = await pay(booking.id, { simulate: 'SUCCESS' });
    expect(retry.status).toBe(201);
    expect(retry.body.id).not.toBe(failed.body.id);
    const row = await bookingRow(booking.id);
    expect(row.status).toBe('CONFIRMED');
    expect(row.payments.map((p) => p.status).sort()).toEqual(['FAILED', 'SUCCESS']);
  });

  test('no token → 401', async () => {
    expectErrorShape(await request(getApp()).post('/api/v1/payments').send({ bookingId: randomId() }), 401);
  });

  test("paying another user's booking → 403", async () => {
    const booking = await makeBooking(alice.token);
    expectErrorShape(await pay(booking.id, { simulate: 'SUCCESS', tok: bob.token }), 403);
  });

  test('unknown bookingId → 404; malformed bookingId → 422', async () => {
    expectErrorShape(await pay(randomId(), { simulate: 'SUCCESS' }), 404);
    expectErrorShape(await pay('not-a-uuid'), 422);
  });

  test('double payment on CONFIRMED booking → 409 PAYMENT_ALREADY_EXISTS', async () => {
    const booking = await makeBooking();
    await pay(booking.id, { simulate: 'SUCCESS' });
    expectErrorShape(await pay(booking.id, { simulate: 'SUCCESS' }), 409, 'PAYMENT_ALREADY_EXISTS');
  });

  test('payment on CANCELLED booking → 409 BOOKING_CANCELLED', async () => {
    const booking = await makeBooking();
    await cancel(booking.id);
    expectErrorShape(await pay(booking.id, { simulate: 'SUCCESS' }), 409, 'BOOKING_CANCELLED');
  });

  test('a PENDING attempt blocks another payment → 409 PAYMENT_IN_PROGRESS', async () => {
    const { booking } = await pendingPayment();
    expectErrorShape(await pay(booking.id, { simulate: 'SUCCESS' }), 409, 'PAYMENT_IN_PROGRESS');
  });

  test('concurrent payments for one booking reach the gateway exactly once', async () => {
    const charge = jest.spyOn(gateway, 'charge');
    const booking = await makeBooking();
    const results = await Promise.all([1, 2, 3].map(() => pay(booking.id, { simulate: 'SUCCESS' })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    expect(charge).toHaveBeenCalledTimes(1);
    expect((await bookingRow(booking.id)).payments).toHaveLength(1);
  });

  test('concurrent retries after FAILED charge once', async () => {
    const booking = await makeBooking();
    await pay(booking.id, { simulate: 'FAILED' });
    const charge = jest.spyOn(gateway, 'charge');
    const results = await Promise.all([1, 2].map(() => pay(booking.id, { simulate: 'SUCCESS' })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(charge).toHaveBeenCalledTimes(1);
    expect((await bookingRow(booking.id)).payments.filter((p) => p.status === 'SUCCESS')).toHaveLength(1);
  });

  test('GET /payments/:id owner → 200; other user → 403; missing → 404', async () => {
    const app = getApp();
    const booking = await makeBooking();
    const { body } = await pay(booking.id, { simulate: 'SUCCESS' });
    expect((await request(app).get(`/api/v1/payments/${body.id}`).set(authHeader(alice.token))).status).toBe(200);
    expectErrorShape(await request(app).get(`/api/v1/payments/${body.id}`).set(authHeader(bob.token)), 403);
    expect((await request(app).get(`/api/v1/payments/${randomId()}`).set(authHeader(alice.token))).status).toBe(404);
  });
});

describe('Idempotency-Key', () => {
  test('same key returns the SAME payment with 200 and no new charge', async () => {
    const booking = await makeBooking();
    const key = idemKey();
    const r1 = await pay(booking.id, { simulate: 'SUCCESS', key });
    const charge = jest.spyOn(gateway, 'charge');
    const r2 = await pay(booking.id, { simulate: 'SUCCESS', key });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.id).toBe(r1.body.id);
    expect(charge).not.toHaveBeenCalled();
  });

  test('concurrent requests with one key produce one payment', async () => {
    const booking = await makeBooking();
    const key = idemKey();
    const [r1, r2] = await Promise.all([pay(booking.id, { simulate: 'SUCCESS', key }), pay(booking.id, { simulate: 'SUCCESS', key })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.body.id).toBe(r2.body.id);
  });

  test('reusing a key for a different booking → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const [b1, b2] = [await makeBooking(), await makeBooking()];
    const key = idemKey();
    await pay(b1.id, { simulate: 'SUCCESS', key });
    expectErrorShape(await pay(b2.id, { simulate: 'SUCCESS', key }), 422, 'IDEMPOTENCY_KEY_REUSED');
    expect((await bookingRow(b2.id)).status).toBe('PENDING');
  });

  test('keys are scoped per user', async () => {
    const key = idemKey();
    const a = await pay((await makeBooking(alice.token)).id, { simulate: 'SUCCESS', key, tok: alice.token });
    const b = await pay((await makeBooking(bob.token)).id, { simulate: 'SUCCESS', key, tok: bob.token });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
  });

  test('over-long key → 422', async () => {
    const booking = await makeBooking();
    expectErrorShape(await pay(booking.id, { key: 'k'.repeat(129) }), 422, 'VALIDATION_ERROR');
  });
});

describe('Cancelling and payments', () => {
  test('cancel while a payment is PENDING → 409 PAYMENT_IN_PROGRESS', async () => {
    const { booking } = await pendingPayment();
    expectErrorShape(await cancel(booking.id), 409, 'PAYMENT_IN_PROGRESS');
    expect((await bookingRow(booking.id)).status).toBe('PENDING');
  });

  test('cancelling a CONFIRMED booking refunds its payment', async () => {
    const booking = await makeBooking();
    await pay(booking.id, { simulate: 'SUCCESS' });
    const res = await cancel(booking.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.payments.map((p) => p.status)).toEqual(['REFUNDED']);
  });

  test('a FAILED booking can be cancelled', async () => {
    const booking = await makeBooking();
    await pay(booking.id, { simulate: 'FAILED' });
    expect((await cancel(booking.id)).body.status).toBe('CANCELLED');
  });

  test('pay and cancel racing never leave a captured payment on a cancelled booking', async () => {
    for (let i = 0; i < 5; i += 1) {
      const booking = await makeBooking();
      const [payRes, cancelRes] = await Promise.all([
        pay(booking.id, { simulate: 'SUCCESS' }),
        new Promise((resolve) => setTimeout(resolve, i * 10)).then(() => cancel(booking.id)),
      ]);
      const row = await bookingRow(booking.id);
      expect(row.status === 'CANCELLED' && row.payments.some((p) => p.status === 'SUCCESS')).toBe(false);
      expect([201, 409]).toContain(payRes.status);
      expect([200, 409]).toContain(cancelRes.status);
    }
  });
});

describe('Webhook — authenticity', () => {
  test('missing signature → 401 and nothing changes', async () => {
    const { booking, payment } = await pendingPayment();
    const res = await request(getApp())
      .post('/api/v1/payments/webhook')
      .send({ eventId: eventId(), paymentId: payment.id, status: 'SUCCESS' });
    expectErrorShape(res, 401, 'INVALID_SIGNATURE');
    expect((await bookingRow(booking.id)).status).toBe('PENDING');
  });

  test('wrong signature → 401', async () => {
    const { payment } = await pendingPayment();
    const res = await postWebhook({ eventId: eventId(), paymentId: payment.id, status: 'SUCCESS' }, { signature: 'ab'.repeat(32) });
    expectErrorShape(res, 401, 'INVALID_SIGNATURE');
  });

  test('stale timestamp → 401', async () => {
    const { payment } = await pendingPayment();
    const res = await postWebhook(
      { eventId: eventId(), paymentId: payment.id, status: 'SUCCESS' },
      { timestamp: Math.floor(Date.now() / 1000) - 3600 }
    );
    expectErrorShape(res, 401, 'INVALID_SIGNATURE');
  });

  test('a bookingId alone can no longer confirm a booking', async () => {
    const booking = await makeBooking();
    const res = await postWebhook({ eventId: eventId(), bookingId: booking.id, status: 'SUCCESS' });
    expectErrorShape(res, 422, 'VALIDATION_ERROR');
    const row = await bookingRow(booking.id);
    expect(row.status).toBe('PENDING');
    expect(row.payments).toHaveLength(0);
  });
});

describe('Webhook — processing', () => {
  test('SUCCESS settles a PENDING payment by paymentId → booking CONFIRMED', async () => {
    const { booking, payment } = await pendingPayment();
    const res = await postWebhook({ eventId: eventId(), paymentId: payment.id, status: 'SUCCESS' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deduped: false, applied: true });
    const row = await bookingRow(booking.id);
    expect(row.status).toBe('CONFIRMED');
    expect(row.payments[0].status).toBe('SUCCESS');
  });

  test('FAILED settles by providerTxnId → booking FAILED', async () => {
    const { booking, payment } = await pendingPayment();
    const res = await postWebhook({ eventId: eventId(), providerTxnId: payment.providerTxnId, status: 'FAILED' });
    expect(res.status).toBe(200);
    expect((await bookingRow(booking.id)).status).toBe('FAILED');
  });

  test('duplicate eventId → deduped:true with zero state change', async () => {
    const { booking, payment } = await pendingPayment();
    const body = { eventId: eventId(), paymentId: payment.id, status: 'SUCCESS' };
    expect((await postWebhook(body)).status).toBe(200);
    const afterFirst = await bookingRow(booking.id);
    const second = await postWebhook(body);
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    const afterSecond = await bookingRow(booking.id);
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt);
    expect(afterSecond.payments[0].updatedAt).toEqual(afterFirst.payments[0].updatedAt);
  });

  test('concurrent duplicate webhooks: both 200, processed once', async () => {
    const { booking, payment } = await pendingPayment();
    const body = { eventId: eventId('_race'), paymentId: payment.id, status: 'SUCCESS' };
    const [r1, r2] = await Promise.all([postWebhook(body), postWebhook(body)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect([r1.body.deduped, r2.body.deduped].sort()).toEqual([false, true]);
    expect((await bookingRow(booking.id)).status).toBe('CONFIRMED');
    expect((await prisma.webhookEvent.findUnique({ where: { eventId: body.eventId } })).attempts).toBe(1);
  });

  test('late conflicting event for a settled payment → 200 applied:false, nothing flips', async () => {
    const { booking, payment } = await pendingPayment();
    await postWebhook({ eventId: eventId('_a'), paymentId: payment.id, status: 'SUCCESS' });
    const late = await postWebhook({ eventId: eventId('_b'), paymentId: payment.id, status: 'FAILED' });
    expect(late.status).toBe(200);
    expect(late.body.applied).toBe(false);
    const row = await bookingRow(booking.id);
    expect(row.status).toBe('CONFIRMED');
    expect(row.payments[0].status).toBe('SUCCESS');
  });

  test('event for a payment that already settled synchronously is ignored', async () => {
    const booking = await makeBooking();
    const { body: payment } = await pay(booking.id, { simulate: 'FAILED' });
    const res = await postWebhook({ eventId: eventId(), paymentId: payment.id, status: 'SUCCESS' });
    expect(res.body.applied).toBe(false);
    expect((await bookingRow(booking.id)).status).toBe('FAILED');
  });

  test('missing eventId or invalid status → 422', async () => {
    const { payment } = await pendingPayment();
    expectErrorShape(await postWebhook({ paymentId: payment.id, status: 'SUCCESS' }), 422);
    expectErrorShape(await postWebhook({ eventId: eventId(), paymentId: payment.id, status: 'WEIRD' }), 422);
  });

  test('unknown payment reference → 404 and nothing stored', async () => {
    const id = eventId();
    expect((await postWebhook({ eventId: id, paymentId: randomId(), status: 'SUCCESS' })).status).toBe(404);
    expect(await prisma.webhookEvent.findUnique({ where: { eventId: id } })).toBeNull();
  });

  test('paymentId and providerTxnId of different payments → 422', async () => {
    const { payment: a } = await pendingPayment();
    const { payment: b } = await pendingPayment();
    const res = await postWebhook({ eventId: eventId(), paymentId: a.id, providerTxnId: b.providerTxnId, status: 'SUCCESS' });
    expectErrorShape(res, 422, 'PAYMENT_REFERENCE_MISMATCH');
  });
});

describe('Webhook — retries', () => {
  test('a stored but unprocessed event is processed on redelivery (not deduped)', async () => {
    const { booking, payment } = await pendingPayment();
    const id = eventId('_stuck');
    await prisma.webhookEvent.create({ data: { eventId: id, paymentId: payment.id, status: 'SUCCESS', payload: {} } });
    const res = await postWebhook({ eventId: id, paymentId: payment.id, status: 'SUCCESS' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deduped: false, applied: true });
    expect((await bookingRow(booking.id)).status).toBe('CONFIRMED');
  });

  test('processing failure → 202 queued, state rolled back, worker retry then applies it', async () => {
    const { booking, payment } = await pendingPayment();
    const id = eventId('_flaky');
    jest.spyOn(paymentsService, 'applyPaymentStatus').mockRejectedValueOnce(new Error('db blip'));

    const res = await postWebhook({ eventId: id, paymentId: payment.id, status: 'SUCCESS' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true, deduped: false, queued: true });
    expect(queue.queuedInTests()).toContain(id);
    const stored = await prisma.webhookEvent.findUnique({ where: { eventId: id } });
    expect(stored).toMatchObject({ processedAt: null, attempts: 1, lastError: 'db blip' });
    expect((await bookingRow(booking.id)).status).toBe('PENDING');

    await expect(webhookService.processWebhookEvent(id)).resolves.toMatchObject({ applied: true });
    expect((await bookingRow(booking.id)).status).toBe('CONFIRMED');
    expect(await prisma.webhookEvent.findUnique({ where: { eventId: id } })).toMatchObject({
      outcome: 'APPLIED',
      attempts: 2,
      lastError: null,
    });
  });

  test('processing failure with the queue down → 503, and redelivery recovers', async () => {
    const { booking, payment } = await pendingPayment();
    const body = { eventId: eventId('_down'), paymentId: payment.id, status: 'SUCCESS' };
    jest.spyOn(paymentsService, 'applyPaymentStatus').mockRejectedValueOnce(new Error('db blip'));
    jest.spyOn(queue, 'enqueueWebhookRetry').mockResolvedValueOnce({ queued: false });

    expectErrorShape(await postWebhook(body), 503, 'WEBHOOK_RETRY_LATER');
    const redelivery = await postWebhook(body);
    expect(redelivery.status).toBe(200);
    expect(redelivery.body.deduped).toBe(false);
    expect((await bookingRow(booking.id)).status).toBe('CONFIRMED');
  });
});
