'use strict';

// The event row is stored before processing, so a failure leaves it for a retry instead of losing it.
const { prisma } = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const payments = require('./payments.service');
const queue = require('../../queue/paymentJobs');

async function resolvePayment({ paymentId, providerTxnId }) {
  const payment = await prisma.payment.findUnique({
    where: paymentId ? { id: paymentId } : { providerTxnId },
  });
  if (!payment) throw new ApiError(404, 'NOT_FOUND', 'Payment reference not found');
  if (paymentId && providerTxnId && payment.providerTxnId && payment.providerTxnId !== providerTxnId) {
    throw new ApiError(422, 'PAYMENT_REFERENCE_MISMATCH', 'paymentId and providerTxnId do not match');
  }
  return payment;
}

async function processWebhookEvent(eventId) {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw`SELECT "processedAt" FROM "WebhookEvent" WHERE "eventId" = ${eventId} FOR UPDATE`;
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Webhook event not found');
    if (row.processedAt) {
      logger.info({ event: 'webhook.deduped', eventId });
      return { ok: true, deduped: true };
    }

    const event = await tx.webhookEvent.findUniqueOrThrow({ where: { eventId } });
    const { applied } = await payments.applyPaymentStatus(tx, event.paymentId, event.status);
    await tx.webhookEvent.update({
      where: { eventId },
      data: {
        processedAt: new Date(),
        outcome: applied ? 'APPLIED' : 'IGNORED',
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    logger.info({ event: 'webhook.processed', eventId, paymentId: event.paymentId, status: event.status, applied });
    return { ok: true, deduped: false, applied };
  });
}

async function recordWebhookFailure(eventId, err) {
  logger.warn({ event: 'webhook.process_failed', eventId, err: err.message });
  try {
    await prisma.webhookEvent.update({
      where: { eventId },
      data: { attempts: { increment: 1 }, lastError: String(err.message).slice(0, 500) },
    });
  } catch (recordErr) {
    logger.warn({ event: 'webhook.record_failure_failed', eventId, err: recordErr.message });
  }
}

async function receiveWebhook({ eventId, paymentId, providerTxnId, status }, payload) {
  logger.info({ event: 'webhook.received', eventId, status });
  const payment = await resolvePayment({ paymentId, providerTxnId });
  await prisma.webhookEvent.createMany({
    data: [{ eventId, paymentId: payment.id, status, payload }],
    skipDuplicates: true,
  });

  try {
    return await processWebhookEvent(eventId);
  } catch (err) {
    // Even if Redis drops the job, the reconciliation sweep finishes the stored event.
    await recordWebhookFailure(eventId, err);
    await queue.enqueueWebhookRetry(eventId);
    return { ok: true, deduped: false, deferred: true };
  }
}

module.exports = { receiveWebhook, processWebhookEvent, recordWebhookFailure };
