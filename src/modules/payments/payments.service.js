'use strict';

const { prisma } = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const { scopedKey } = require('../../utils/idempotency');
const logger = require('../../utils/logger');
const bookings = require('../bookings/bookings.service');
const gateway = require('./mockGateway');
const { toPublicPayment } = require('./publicPayment');

const SETTLE_ATTEMPTS = 3;
const SETTLE_RETRY_MS = 100;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Inserts a PENDING attempt under the booking lock *before* charging, so concurrent
// requests can never reach the gateway twice for one booking.
async function claimAttempt(userId, bookingId, keyHash) {
  return prisma.$transaction(async (tx) => {
    const booking = await bookings.lockBooking(tx, bookingId);
    bookings.assertOwner(booking, userId);

    if (keyHash) {
      const existing = await tx.payment.findUnique({ where: { idempotencyKey: keyHash } });
      if (existing) {
        if (existing.bookingId !== bookingId) {
          throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used for another booking');
        }
        return { payment: existing, replay: true };
      }
    }

    if (booking.status === 'CANCELLED') {
      throw new ApiError(409, 'BOOKING_CANCELLED', 'Cannot pay for a cancelled booking');
    }
    if (booking.status === 'CONFIRMED') {
      throw new ApiError(409, 'PAYMENT_ALREADY_EXISTS', 'Booking is already paid');
    }
    if (booking.appointmentAt <= new Date()) {
      throw new ApiError(409, 'APPOINTMENT_PASSED', 'The appointment time has passed');
    }
    const inFlight = await tx.payment.findFirst({ where: { bookingId, status: 'PENDING' } });
    if (inFlight) throw new ApiError(409, 'PAYMENT_IN_PROGRESS', 'A payment for this booking is in progress');

    const payment = await tx.payment.create({
      data: { bookingId, amount: booking.amount, idempotencyKey: keyHash },
    });
    return { payment, replay: false };
  });
}

// Moves a PENDING payment to SUCCESS/FAILED and drives the booking. Settled payments are
// never changed again, so late or conflicting outcomes return { applied: false }.
async function applyPaymentStatus(tx, paymentId, status, providerTxnId) {
  const { bookingId } = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const booking = await bookings.lockBooking(tx, bookingId);
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const recordTxn = providerTxnId && !payment.providerTxnId ? { providerTxnId } : null;

  if (payment.status !== 'PENDING' || status === 'PENDING') {
    if (!recordTxn) return { payment, applied: false };
    return { payment: await tx.payment.update({ where: { id: paymentId }, data: recordTxn }), applied: false };
  }

  const updated = await tx.payment.update({ where: { id: paymentId }, data: { status, ...recordTxn } });
  await bookings.applyPaymentOutcome(tx, booking, status);
  return { payment: updated, applied: true };
}

async function settlePayment(paymentId, { status, providerTxnId }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => applyPaymentStatus(tx, paymentId, status, providerTxnId));
    } catch (err) {
      if (attempt === SETTLE_ATTEMPTS) throw err;
      await delay(SETTLE_RETRY_MS * attempt);
    }
  }
}

// On any failure the attempt stays PENDING and the reconciliation job settles it from the provider's record.
async function chargeAndSettle(attempt, simulate) {
  try {
    const result = await gateway.charge({ reference: attempt.id, simulate });
    return (await settlePayment(attempt.id, result)).payment;
  } catch (err) {
    logger.error({ event: 'payment.settle_deferred', paymentId: attempt.id, err });
    return attempt;
  }
}

async function createPayment(userId, { bookingId, simulate, idempotencyKey }) {
  const keyHash = idempotencyKey ? scopedKey(userId, idempotencyKey) : null;
  let claim;
  try {
    claim = await claimAttempt(userId, bookingId, keyHash);
  } catch (err) {
    // Same key raced on two bookings: the unique index rejected the loser; re-run to classify it.
    if (err.code !== 'P2002') throw err;
    claim = await claimAttempt(userId, bookingId, keyHash);
  }

  if (claim.replay) {
    logger.info({ event: 'payment.idempotent_replay', paymentId: claim.payment.id, bookingId });
    return { payment: toPublicPayment(claim.payment), replay: true };
  }

  const payment = await chargeAndSettle(claim.payment, simulate);
  logger.info({ event: 'payment.charged', paymentId: payment.id, bookingId, status: payment.status });
  return { payment: toPublicPayment(payment), replay: false };
}

async function getPaymentById(userId, id) {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { booking: { select: { userId: true } } },
  });
  if (!payment) throw new ApiError(404, 'NOT_FOUND', 'Payment not found');
  if (payment.booking.userId !== userId) throw new ApiError(403, 'FORBIDDEN', 'You do not own this payment');
  return toPublicPayment(payment);
}

module.exports = { createPayment, getPaymentById, applyPaymentStatus, settlePayment };
