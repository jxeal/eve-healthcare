'use strict';

const { Queue } = require('bullmq');
const config = require('../config');
const logger = require('../utils/logger');
const { createQueueConnection } = require('./connection');

const QUEUE_NAME = 'payment-jobs';
const JOBS = { PROCESS_WEBHOOK_EVENT: 'process-webhook-event', RECONCILE: 'reconcile-payments' };
const ENQUEUE_TIMEOUT_MS = 2000;

let queue = null;
const testJobs = [];

function getQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: createQueueConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    queue.on('error', (err) => logger.warn({ event: 'queue.error', err: err.message }));
  }
  return queue;
}

// The connection retries forever while Redis is down, so bound the wait.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`enqueue timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// No custom job id: BullMQ silently skips an add whose id it still remembers, even a failed one.
async function enqueueWebhookRetry(eventId) {
  if (config.env === 'test') {
    testJobs.push(eventId);
    return { queued: true };
  }
  try {
    await withTimeout(getQueue().add(JOBS.PROCESS_WEBHOOK_EVENT, { eventId }), ENQUEUE_TIMEOUT_MS);
    logger.info({ event: 'queue.enqueued', eventId });
    return { queued: true };
  } catch (err) {
    logger.warn({ event: 'queue.enqueue_failed', eventId, err: err.message });
    return { queued: false };
  }
}

// Upserting is idempotent, so every API and worker process can call it on boot.
async function scheduleReconciliation() {
  await getQueue().upsertJobScheduler(
    JOBS.RECONCILE,
    { every: config.reconcile.intervalSec * 1000 },
    { name: JOBS.RECONCILE, opts: { attempts: 1 } }
  );
}

async function closeQueue() {
  if (queue) await queue.close();
  queue = null;
}

// Under NODE_ENV=test nothing reaches Redis; tests inspect what would have been queued.
function queuedInTests() {
  return testJobs;
}

module.exports = { QUEUE_NAME, JOBS, enqueueWebhookRetry, scheduleReconciliation, closeQueue, queuedInTests };
