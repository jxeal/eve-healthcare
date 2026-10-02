'use strict';

const crypto = require('crypto');
const { Queue } = require('bullmq');
const config = require('../config');
const logger = require('../utils/logger');
const { createQueueConnection } = require('./connection');

const QUEUE_NAME = 'webhook-retries';
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

// BullMQ rejects custom job ids containing ':', which provider event ids may have.
function jobIdFor(eventId) {
  return `evt-${crypto.createHash('sha256').update(eventId).digest('hex').slice(0, 32)}`;
}

// The connection retries forever while Redis is down, so bound the wait.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`enqueue timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function enqueueWebhookRetry(eventId) {
  if (config.env === 'test') {
    testJobs.push(eventId);
    return { queued: true };
  }
  try {
    await withTimeout(
      getQueue().add('process-webhook-event', { eventId }, { jobId: jobIdFor(eventId) }),
      ENQUEUE_TIMEOUT_MS
    );
    logger.info({ event: 'queue.enqueued', eventId });
    return { queued: true };
  } catch (err) {
    logger.warn({ event: 'queue.enqueue_failed', eventId, err: err.message });
    return { queued: false };
  }
}

// Under NODE_ENV=test nothing reaches Redis; tests inspect what would have been queued.
function queuedInTests() {
  return testJobs;
}

module.exports = { QUEUE_NAME, enqueueWebhookRetry, jobIdFor, queuedInTests };
