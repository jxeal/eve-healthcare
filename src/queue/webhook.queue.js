'use strict';

// Outbox for webhook apply-retries (the "background jobs" bonus).
//
// When the synchronous webhook apply hits a transient downstream error,
// handleWebhook() returns 200 { retryable: true } AND enqueues this job so
// the retry happens even if the provider never re-posts. Processing stays
// idempotent: jobId === eventId (queue-level dedupe of the same event) and
// the worker re-runs the terminal-safe apply, which no-ops on settled rows.
//
// Degradation contract (mirrors the Redis cache philosophy):
//   - NODE_ENV === 'test'  → in-memory stub, no sockets (jest stays clean).
//   - Redis down           → logged no-op { queued: false }; the provider
//                            retry path ({ retryable: true }) still applies.
const logger = require('../utils/logger');

const QUEUE_NAME = 'webhook-retries';

let QueueRef = null;
try {
  // eslint-disable-next-line global-require
  QueueRef = require('bullmq').Queue;
} catch {
  QueueRef = null;
}

let queue = null;
const stubJobs = [];

function isStubMode() {
  return process.env.NODE_ENV === 'test' || !QueueRef;
}

function getQueue() {
  if (isStubMode()) return null;
  if (queue) return queue;
  // eslint-disable-next-line global-require
  const { createQueueConnection } = require('./connection');
  queue = new QueueRef(QUEUE_NAME, {
    connection: createQueueConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  queue.on('error', (err) => logger.warn({ event: 'queue.error', err: err && err.message }));
  return queue;
}

async function enqueueWebhookRetry({ eventId, status, paymentId, providerTxnId, bookingId }) {
  const jobData = { eventId, status, paymentId: paymentId || null, providerTxnId: providerTxnId || null, bookingId: bookingId || null };
  if (isStubMode()) {
    stubJobs.push(jobData);
    logger.info({ event: 'queue.enqueued_stub', eventId, status });
    return { queued: true, stub: true, jobId: eventId };
  }
  try {
    const q = getQueue();
    const job = await q.add('webhook-apply-retry', jobData, { jobId: eventId });
    logger.info({ event: 'queue.enqueued', eventId, status, jobId: job.id });
    return { queued: true, stub: false, jobId: job.id };
  } catch (err) {
    logger.warn({ event: 'queue.enqueue_failed', eventId, err: err && err.message });
    return { queued: false, reason: err && err.message };
  }
}

async function closeWebhookQueue() {
  try {
    if (queue) await queue.close();
  } catch {
    // ignore
  } finally {
    queue = null;
  }
}

// Test seam: lets a unit/smoke check assert enqueue intent without Redis.
function __stubJobs() {
  return stubJobs;
}

module.exports = { enqueueWebhookRetry, closeWebhookQueue, __stubJobs, QUEUE_NAME };
