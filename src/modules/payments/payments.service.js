'use strict';

const { prisma } = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const gateway = require('./mockGateway');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadBookingsService() {
  try {
    // Agent-3 owns this module; fall back to a direct update when absent.
    return require('../bookings/bookings.service');
  } catch {
    return null;
  }
}

// Applies a gateway outcome to the booking via Agent-3's helper when
// available, otherwise updates PENDING bookings directly (terminal-safe).
async function applyResult(bookingId, status) {
  const bookings = loadBookingsService();
  if (bookings && typeof bookings.applyPaymentResult === 'function') {
    return bookings.applyPaymentResult(bookingId, status);
  }
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return null;
  if (booking.status === 'PENDING') {
    return prisma.booking.update({
      where: { id: bookingId },
      data: { status: status === 'SUCCESS' ? 'CONFIRMED' : 'FAILED' },
    });
  }
  if (booking.status === 'FAILED' && status === 'SUCCESS') {
    return prisma.booking.update({ where: { id: bookingId }, data: { status: 'CONFIRMED' } });
  }
  return booking;
}

function withoutBooking(payment) {
  if (!payment) return payment;
  const { booking: _booking, ...rest } = payment;
  return rest;
}

async function createPayment(userId, { bookingId, simulate, idempotencyKey }) {
  const key =
    typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : null;

  // 1. Idempotency replay wins: same key → SAME payment, no new charge.
  if (key) {
    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey: key },
      include: { booking: true },
    });
    if (existing) {
      if (existing.booking.userId !== userId) {
        throw new ApiError(403, 'FORBIDDEN', 'Idempotency key already in use');
      }
      logger.info({
        event: 'payment.idempotent_replay',
        paymentId: existing.id,
        bookingId: existing.bookingId,
      });
      return { payment: withoutBooking(existing), replay: true };
    }
  }

  // 2. Booking guards.
  if (!UUID_RE.test(bookingId || '')) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
  if (booking.userId !== userId) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not own this booking');
  }
  if (booking.status === 'CANCELLED') {
    throw new ApiError(409, 'BOOKING_CANCELLED', 'Cannot pay for a cancelled booking');
  }
  if ((booking.payment && booking.payment.status === 'SUCCESS') || booking.status === 'CONFIRMED') {
    throw new ApiError(409, 'PAYMENT_ALREADY_EXISTS', 'Booking is already paid');
  }

  // 3. Charge through the simulated gateway.
  const result = await gateway.charge({ amount: Number(booking.amount), simulate });
  logger.info({ event: 'payment.gateway_result', bookingId, status: result.status });

  // Retry path: a FAILED payment row already exists for this booking
  // (bookingId is UNIQUE), so recharge into the same row.
  if (booking.payment) {
    const payment = await prisma.payment.update({
      where: { id: booking.payment.id },
      data: {
        amount: booking.amount,
        status: result.status,
        providerTxnId: result.providerTxnId,
        ...(key ? { idempotencyKey: key } : {}),
      },
    });
    try {
      await applyResult(bookingId, result.status);
    } catch (err) {
      logger.warn({ event: 'payment.apply_failed', bookingId, status: result.status, err: err && err.message });
    }
    logger.info({ event: 'payment.retried', paymentId: payment.id, bookingId, status: payment.status });
    return { payment, replay: false };
  }

  let payment;
  try {
    payment = await prisma.payment.create({
      data: {
        bookingId,
        amount: booking.amount,
        status: result.status,
        providerTxnId: result.providerTxnId,
        idempotencyKey: key,
      },
    });
  } catch (err) {
    if (err && err.code === 'P2002') {
      // Lost a race (same idempotency key / booking): return the winner.
      const winner = key
        ? await prisma.payment.findUnique({ where: { idempotencyKey: key } })
        : await prisma.payment.findUnique({ where: { bookingId } });
      if (winner) {
        logger.info({ event: 'payment.race_replay', paymentId: winner.id, bookingId });
        return { payment: winner, replay: true };
      }
    }
    throw err;
  }

  try {
    await applyResult(bookingId, result.status);
  } catch (err) {
    logger.warn({ event: 'payment.apply_failed', bookingId, status: result.status, err: err && err.message });
  }
  const fresh = await prisma.payment.findUnique({ where: { id: payment.id } });
  logger.info({ event: 'payment.created', paymentId: payment.id, bookingId, status: payment.status });
  return { payment: fresh || payment, replay: false };
}

async function getPaymentById(userId, id) {
  if (!UUID_RE.test(id || '')) throw new ApiError(404, 'NOT_FOUND', 'Payment not found');
  const payment = await prisma.payment.findUnique({ where: { id }, include: { booking: true } });
  if (!payment) throw new ApiError(404, 'NOT_FOUND', 'Payment not found');
  if (payment.booking.userId !== userId) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not own this payment');
  }
  return withoutBooking(payment);
}

module.exports = { createPayment, getPaymentById, applyResult };
