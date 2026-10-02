const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const { getApp } = require('../helpers/app');
const { signupUser, createAdmin, authHeader } = require('../helpers/auth');
const { futureISO } = require('../helpers/assert');
const { createCentreWithTest } = require('../helpers/catalog');
const { prisma } = require('../../src/config/db');
const gateway = require('../../src/modules/payments/mockGateway');
const paymentsService = require('../../src/modules/payments/payments.service');
const { runReconciliation } = require('../../src/modules/payments/reconciliation.service');

let user;
let centre;
let diagTest;

const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

// A separate process shares no memory with this one, like an extra `npm run worker`.
function reconcileInAnotherProcess(now) {
  const script =
    "require('./src/modules/payments/reconciliation.service').runReconciliation({ now: new Date(process.argv[1]) })" +
    '.then(() => process.exit(0), (err) => { console.error(err); process.exit(1); })';
  const result = spawnSync(process.execPath, ['-e', script, now.toISOString()], {
    cwd: path.join(__dirname, '../..'),
    env: process.env,
    encoding: 'utf8',
    timeout: 20000,
  });
  if (result.status !== 0) throw new Error(`reconciliation process failed: ${result.stderr}`);
}

beforeAll(async () => {
  user = await signupUser();
  const { token } = await createAdmin();
  ({ centre, test: diagTest } = await createCentreWithTest(token));
});

afterEach(() => jest.restoreAllMocks());

async function makeBooking() {
  const res = await request(getApp())
    .post('/api/v1/bookings')
    .set(authHeader(user.token))
    .send({ centreId: centre.id, testId: diagTest.id, appointmentAt: futureISO() });
  expect(res.status).toBe(201);
  return res.body;
}

const pay = (bookingId, simulate) =>
  request(getApp()).post('/api/v1/payments').set(authHeader(user.token)).send({ bookingId, simulate });
const cancel = (bookingId) =>
  request(getApp()).post(`/api/v1/bookings/${bookingId}/cancel`).set(authHeader(user.token));
const latestPayment = (bookingId) => prisma.payment.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' } });
const bookingStatus = async (id) => (await prisma.booking.findUnique({ where: { id } })).status;

// Fails the settle transactions that follow the claim, as if the database dropped out mid-request.
function failSettleTransactions(times = Infinity) {
  const realTransaction = prisma.$transaction.bind(prisma);
  let calls = 0;
  jest.spyOn(prisma, '$transaction').mockImplementation((...args) => {
    calls += 1;
    if (calls > 1 && calls <= times + 1) return Promise.reject(new Error('connection dropped'));
    return realTransaction(...args);
  });
}

describe('Payments whose save step fails', () => {
  test('a transient failure is retried inline → 201 SUCCESS', async () => {
    const booking = await makeBooking();
    failSettleTransactions(1);
    const res = await pay(booking.id, 'SUCCESS');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SUCCESS');
    expect(await bookingStatus(booking.id)).toBe('CONFIRMED');
  });

  test('a lasting failure → 202 PENDING; reconciliation settles it from the provider record', async () => {
    const booking = await makeBooking();
    failSettleTransactions();
    const res = await pay(booking.id, 'SUCCESS');
    jest.restoreAllMocks();
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('PENDING');

    const summary = await runReconciliation({ now: minutesFromNow(5) });
    expect(summary.payments.provider_result).toBeGreaterThanOrEqual(1);
    expect(await latestPayment(booking.id)).toMatchObject({ status: 'SUCCESS', providerTxnId: expect.any(String) });
    expect(await bookingStatus(booking.id)).toBe('CONFIRMED');
  });

  test('a gateway error → 202; unknown to the provider, so reconciliation fails it and a retry works', async () => {
    const booking = await makeBooking();
    jest.spyOn(gateway, 'charge').mockRejectedValueOnce(new Error('provider timeout'));
    expect((await pay(booking.id, 'SUCCESS')).status).toBe(202);

    await runReconciliation({ now: minutesFromNow(5) });
    expect((await latestPayment(booking.id)).status).toBe('FAILED');
    expect(await bookingStatus(booking.id)).toBe('FAILED');
    expect((await pay(booking.id, 'SUCCESS')).status).toBe(201);
  });

  test('an attempt younger than PAYMENT_STALE_AFTER_SEC is left alone', async () => {
    const booking = await makeBooking();
    failSettleTransactions();
    await pay(booking.id, 'SUCCESS');
    jest.restoreAllMocks();
    await runReconciliation();
    expect((await latestPayment(booking.id)).status).toBe('PENDING');
  });
});

describe('Reconciliation in another process', () => {
  test('sees the same provider records, so pending charges wait and lost saves settle', async () => {
    const pendingBooking = await makeBooking();
    expect((await pay(pendingBooking.id, 'PENDING')).status).toBe(202);
    const lostBooking = await makeBooking();
    failSettleTransactions();
    expect((await pay(lostBooking.id, 'SUCCESS')).status).toBe(202);
    jest.restoreAllMocks();

    reconcileInAnotherProcess(minutesFromNow(5));

    expect((await latestPayment(pendingBooking.id)).status).toBe('PENDING');
    expect((await latestPayment(lostBooking.id)).status).toBe('SUCCESS');
    expect(await bookingStatus(lostBooking.id)).toBe('CONFIRMED');
  });
});

describe('Provider-pending payments', () => {
  test('wait for the provider, then expire so the booking can be cancelled', async () => {
    const booking = await makeBooking();
    expect((await pay(booking.id, 'PENDING')).status).toBe(202);
    expectErrorCode(await cancel(booking.id), 'PAYMENT_IN_PROGRESS');

    await runReconciliation({ now: minutesFromNow(5) });
    expect((await latestPayment(booking.id)).status).toBe('PENDING');

    await runReconciliation({ now: minutesFromNow(31) });
    expect((await latestPayment(booking.id)).status).toBe('FAILED');
    expect((await gateway.retrieve((await latestPayment(booking.id)).id)).status).toBe('FAILED');
    expect((await cancel(booking.id)).status).toBe(200);
  });
});

describe('Provider-pending payments that settle while expiring', () => {
  test('are applied with the provider outcome instead of failed', async () => {
    const booking = await makeBooking();
    const { body: payment } = await pay(booking.id, 'PENDING');
    await prisma.simulatedCharge.update({ where: { reference: payment.id }, data: { status: 'SUCCESS' } });
    const realRetrieve = gateway.retrieve;
    let stale = true;
    jest.spyOn(gateway, 'retrieve').mockImplementation(async (reference) => {
      if (reference !== payment.id || !stale) return realRetrieve(reference);
      stale = false;
      return { providerTxnId: payment.providerTxnId, status: 'PENDING' };
    });

    await runReconciliation({ now: minutesFromNow(31) });
    expect((await latestPayment(booking.id)).status).toBe('SUCCESS');
    expect(await bookingStatus(booking.id)).toBe('CONFIRMED');
  });
});

describe('Webhook events left unprocessed', () => {
  async function storedEvent() {
    const booking = await makeBooking();
    const { body: payment } = await pay(booking.id, 'PENDING');
    const eventId = `sweep_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await prisma.webhookEvent.create({ data: { eventId, paymentId: payment.id, status: 'SUCCESS', payload: {} } });
    return { booking, eventId };
  }

  test('are processed once older than WEBHOOK_RETRY_AFTER_SEC', async () => {
    const { booking, eventId } = await storedEvent();
    await runReconciliation();
    expect((await prisma.webhookEvent.findUnique({ where: { eventId } })).processedAt).toBeNull();

    const summary = await runReconciliation({ now: minutesFromNow(2) });
    expect(summary.webhookEvents.processed).toBeGreaterThanOrEqual(1);
    expect(await prisma.webhookEvent.findUnique({ where: { eventId } })).toMatchObject({ outcome: 'APPLIED' });
    expect(await bookingStatus(booking.id)).toBe('CONFIRMED');
  });

  test('a stored provider event wins even when the provider lookup misses', async () => {
    const { booking, eventId } = await storedEvent();
    const payment = await latestPayment(booking.id);
    await prisma.simulatedCharge.delete({ where: { reference: payment.id } });

    await runReconciliation({ now: minutesFromNow(5) });
    expect((await latestPayment(booking.id)).status).toBe('SUCCESS');
    expect(await prisma.webhookEvent.findUnique({ where: { eventId } })).toMatchObject({ outcome: 'APPLIED' });
  });

  test('a failing event keeps its error and attempt count for the next sweep', async () => {
    const { eventId } = await storedEvent();
    jest.spyOn(paymentsService, 'applyPaymentStatus').mockRejectedValue(new Error('still broken'));
    await runReconciliation({ now: minutesFromNow(2) });
    expect(await prisma.webhookEvent.findUnique({ where: { eventId } })).toMatchObject({
      processedAt: null,
      attempts: 1,
      lastError: 'still broken',
    });
  });
});

function expectErrorCode(res, code) {
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe(code);
}
