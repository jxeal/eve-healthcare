'use strict';

// Idempotent, retry-safe webhook ingestion (+ background retry worker).
//
// Protocol:
//  1. Upsert-first: claim `eventId` in WebhookEvent BEFORE doing any work.
//     - Prisma P2002 on insert ⇒ a duplicate is in flight / already handled
//       ⇒ return { deduped: true } with zero side-effects.
//  2. Resolve the payment by paymentId → providerTxnId → bookingId.
//     Unknown reference ⇒ 404 (placeholder row removed, no phantom payment).
//  3. Terminal-safe apply: a CONFIRMED booking is never flipped to FAILED
//     by a late event; CANCELLED never moves. Such events still return 200.
//  4. Downstream apply errors ⇒ 200 { ok: true, retryable: true } so the
//     provider retries — AND a BullMQ job (jobId === eventId) is enqueued so
//     the retry also happens locally via workers/webhook.worker.js even if
//     the provider never re-posts. The worker re-runs retryWebhookApply(),
//     which no-ops on already-settled rows.
// Malformed payloads are rejected with 422 by the zod layer (routes).
const { randomUUID } = require('crypto');
const { prisma } = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const logger = require('../../utils/logger');

function loadBookingsService() {
  try {
    return require('../bookings/bookings.service');
  } catch {
    return null;
  }
}

function loadRetryQueue() {
  try {
    return require('../../queue/webhook.queue');
  } catch {
    return null;
  }
}

async function applyToBooking(bookingId, status) {
  const bookings = loadBookingsService();
  if (bookings && typeof bookings.applyPaymentResult === 'function') {
    return bookings.applyPaymentResult(bookingId, status);
  }
  const fresh = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!fresh) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
  if (fresh.status === 'PENDING' || (fresh.status === 'FAILED' && status === 'SUCCESS')) {
    return prisma.booking.update({
      where: { id: bookingId },
      data: { status: status === 'SUCCESS' ? 'CONFIRMED' : 'FAILED' },
    });
  }
  return fresh;
}

async function markProcessed(eventId, payment, bookingId) {
  await prisma.webhookEvent.update({
    where: { eventId },
    data: {
      processedAt: new Date(),
      deduped: false,
      paymentId: payment ? payment.id : null,
      bookingId: bookingId || (payment ? payment.bookingId : null),
    },
  });
}

// Shared settle path for a CLAIMED (row exists, processedAt null) event.
// Used by handleWebhook() (fresh claim) and retryWebhookApply() (worker).
async function settleClaim({ eventId, paymentId, providerTxnId, bookingId, status }) {
  const failUnknown = async (message) => {
    try {
      await prisma.webhookEvent.delete({ where: { eventId } });
    } catch {
      // best-effort cleanup
    }
    throw new ApiError(404, 'NOT_FOUND', message);
  };

  // Resolve the payment (paymentId → providerTxnId → bookingId).
  let payment = null;
  if (paymentId) {
    payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { booking: true } });
  } else if (providerTxnId) {
    payment = await prisma.payment.findUnique({
      where: { providerTxnId },
      include: { booking: true },
    });
  } else if (bookingId) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) await failUnknown('Booking not found');
    payment = await prisma.payment.findUnique({ where: { bookingId }, include: { booking: true } });
    if (!payment) {
      // Provider event arrived before any payment row exists: mirror it.
      try {
        payment = await prisma.payment.create({
          data: { bookingId, amount: booking.amount, status, providerTxnId: randomUUID() },
          include: { booking: true },
        });
      } catch (err) {
        if (err && err.code === 'P2002') {
          payment = await prisma.payment.findUnique({ where: { bookingId }, include: { booking: true } });
        } else {
          throw err;
        }
      }
    }
  }
  if (!payment) await failUnknown('Payment reference not found');

  const booking = payment.booking;
  if (!booking) await failUnknown('Payment reference not found');

  // Terminal guard: never corrupt a settled booking on a late event.
  const terminalNoop =
    booking.status === 'CANCELLED' ||
    (booking.status === 'CONFIRMED' && status === 'FAILED') ||
    (booking.status === 'CONFIRMED' && status === 'SUCCESS') ||
    (booking.status === 'FAILED' && status === 'FAILED');
  if (terminalNoop) {
    await markProcessed(eventId, payment, booking.id);
    logger.info({
      event: 'webhook.terminal_noop',
      eventId,
      bookingId: booking.id,
      bookingStatus: booking.status,
      status,
    });
    return { ok: true, deduped: false };
  }

  // Apply (PENDING→CONFIRMED/FAILED, or FAILED→CONFIRMED retry success).
  try {
    if (payment.status !== status) {
      payment = await prisma.payment.update({ where: { id: payment.id }, data: { status } });
    }
    await applyToBooking(booking.id, status);
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'P2025')) {
      await failUnknown('Payment reference not found');
    }
    logger.warn({ event: 'webhook.retryable_error', eventId, status, err: err && err.message });
    // Hand off to the background worker (best-effort; provider retry still applies).
    try {
      const q = loadRetryQueue();
      if (q) await q.enqueueWebhookRetry({ eventId, status, paymentId, providerTxnId, bookingId });
    } catch {
      // enqueue is already null-safe; never fail the webhook on queue errors
    }
    return { ok: true, retryable: true, deduped: false };
  }

  await markProcessed(eventId, payment, booking.id);
  logger.info({ event: 'webhook.processed', eventId, status, paymentId: payment.id, bookingId: booking.id });
  return { ok: true, deduped: false };
}

async function handleWebhook({ eventId, paymentId, providerTxnId, bookingId, status, payload }) {
  logger.info({ event: 'webhook.received', eventId, status });

  // Claim-first insert. P2002 ⇒ duplicate delivery ⇒ dedupe, no-op.
  try {
    await prisma.webhookEvent.create({
      data: {
        eventId,
        paymentId: paymentId || null,
        bookingId: bookingId || null,
        status,
        payload: payload || { eventId, paymentId, providerTxnId, bookingId, status },
      },
    });
  } catch (err) {
    if (err && err.code === 'P2002') {
      logger.info({ event: 'webhook.deduped', eventId });
      return { ok: true, deduped: true };
    }
    throw err;
  }

  return settleClaim({ eventId, paymentId, providerTxnId, bookingId, status });
}

// Worker entry: re-settle a claimed-but-unprocessed event. Idempotent —
// already-processed or missing rows are a no-op (returns { noop: true }).
async function retryWebhookApply(eventId) {
  const claim = await prisma.webhookEvent.findUnique({ where: { eventId } });
  if (!claim) {
    logger.info({ event: 'webhook.retry_noop', eventId, reason: 'no-claim' });
    return { ok: true, noop: true };
  }
  if (claim.processedAt) {
    logger.info({ event: 'webhook.retry_noop', eventId, reason: 'already-processed' });
    return { ok: true, noop: true };
  }
  logger.info({ event: 'webhook.retry_apply', eventId, status: claim.status });
  return settleClaim({
    eventId,
    paymentId: claim.paymentId,
    providerTxnId: (claim.payload && claim.payload.providerTxnId) || null,
    bookingId: claim.bookingId,
    status: claim.status,
  });
}

module.exports = { handleWebhook, retryWebhookApply };
