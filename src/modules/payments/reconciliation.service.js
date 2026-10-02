'use strict';

const { prisma } = require('../../config/db');
const config = require('../../config');
const logger = require('../../utils/logger');
const gateway = require('./mockGateway');
const payments = require('./payments.service');
const webhooks = require('./webhook.service');

const BATCH_SIZE = 100;

const secondsBefore = (date, seconds) => new Date(date.getTime() - seconds * 1000);

// Keyset pagination, so rows a handler leaves unchanged can't be fetched again in the same run.
async function forEachRow(model, where, sortField, idField, handle) {
  let last = null;
  for (;;) {
    const after = last
      ? { OR: [{ [sortField]: { gt: last[sortField] } }, { [sortField]: last[sortField], [idField]: { gt: last[idField] } }] }
      : {};
    const rows = await prisma[model].findMany({
      where: { AND: [where, after] },
      orderBy: [{ [sortField]: 'asc' }, { [idField]: 'asc' }],
      take: BATCH_SIZE,
    });
    for (const row of rows) await handle(row);
    if (rows.length < BATCH_SIZE) return;
    last = rows[rows.length - 1];
  }
}

async function settleAs(payment, status, providerTxnId, reason) {
  const { applied } = await payments.settlePayment(payment.id, { status, providerTxnId });
  logger.info({ event: 'payment.reconciled', paymentId: payment.id, status, reason, applied });
  return reason;
}

async function reconcilePayment(payment, now) {
  const charge = await gateway.retrieve(payment.id);
  if (!charge) return settleAs(payment, 'FAILED', null, 'unknown_to_provider');
  if (charge.status !== 'PENDING') return settleAs(payment, charge.status, charge.providerTxnId, 'provider_result');
  if (now - payment.createdAt < config.reconcile.pendingExpirySec * 1000) return 'still_pending';
  await gateway.cancel(payment.id);
  return settleAs(payment, 'FAILED', charge.providerTxnId, 'expired');
}

async function retryWebhookEvent(event) {
  try {
    await webhooks.processWebhookEvent(event.eventId);
    return 'processed';
  } catch (err) {
    await webhooks.recordWebhookFailure(event.eventId, err);
    return 'failed';
  }
}

function tally(counts, handle) {
  return async (row) => {
    let outcome;
    try {
      outcome = await handle(row);
    } catch (err) {
      logger.warn({ event: 'reconciliation.row_failed', err: err.message });
      outcome = 'error';
    }
    counts[outcome] = (counts[outcome] || 0) + 1;
  };
}

// Settles PENDING payments the request path couldn't finish and processes stored but unprocessed webhook events.
async function runReconciliation({ now = new Date() } = {}) {
  const summary = { payments: {}, webhookEvents: {} };
  const stalePayments = { status: 'PENDING', createdAt: { lt: secondsBefore(now, config.reconcile.staleAfterSec) } };
  await forEachRow('payment', stalePayments, 'createdAt', 'id', tally(summary.payments, (p) => reconcilePayment(p, now)));

  const staleEvents = { processedAt: null, receivedAt: { lt: secondsBefore(now, config.reconcile.webhookRetryAfterSec) } };
  await forEachRow('webhookEvent', staleEvents, 'receivedAt', 'eventId', tally(summary.webhookEvents, retryWebhookEvent));

  if (Object.keys(summary.payments).length || Object.keys(summary.webhookEvents).length) {
    logger.info({ event: 'reconciliation.done', ...summary });
  }
  return summary;
}

module.exports = { runReconciliation };
