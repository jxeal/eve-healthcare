'use strict';

// Background retry worker for webhook apply-failures (the Celery equivalent).
//
// Run modes:
//   - In-process:  src/server.js calls startWebhookWorker() on boot (skipped
//                   when NODE_ENV === 'test' so jest stays socket-free).
//   - Standalone:  `npm run worker` (this file is main) — scale independently
//                   of the API, same code + same idempotency guarantees.
//
// Each job re-runs retryWebhookApply(eventId): terminal-safe, and a no-op on
// already-settled or missing claims. BullMQ gives attempts (5) + exponential
// backoff; jobId === eventId dedupes repeat enqueues of the same event.
const logger = require('../utils/logger');
const { QUEUE_NAME } = require('../queue/webhook.queue');

let WorkerRef = null;
try {
  // eslint-disable-next-line global-require
  WorkerRef = require('bullmq').Worker;
} catch {
  WorkerRef = null;
}

let worker = null;

function processor(job) {
  // Loaded lazily so the worker file imports cleanly without a DB.
  // eslint-disable-next-line global-require
  const { retryWebhookApply } = require('../modules/payments/webhook.service');
  return retryWebhookApply(job.data.eventId);
}

function startWebhookWorker() {
  if (process.env.NODE_ENV === 'test') return null;
  if (worker) return worker;
  if (!WorkerRef) {
    logger.warn({ event: 'worker.bullmq_missing' });
    return null;
  }
  try {
    // eslint-disable-next-line global-require
    const { createQueueConnection } = require('../queue/connection');
    worker = new WorkerRef(QUEUE_NAME, processor, {
      connection: createQueueConnection(),
      concurrency: 5,
    });
    worker.on('completed', (job, result) =>
      logger.info({ event: 'worker.completed', eventId: job.data && job.data.eventId, result })
    );
    worker.on('failed', (job, err) =>
      logger.warn({ event: 'worker.failed', eventId: job && job.data && job.data.eventId, err: err && err.message })
    );
    worker.on('error', (err) => logger.warn({ event: 'worker.error', err: err && err.message }));
    logger.info({ event: 'worker.start', queue: QUEUE_NAME });
  } catch (err) {
    logger.warn({ event: 'worker.start_failed', err: err && err.message });
    worker = null;
  }
  return worker;
}

async function stopWebhookWorker() {
  try {
    if (worker) await worker.close();
  } catch {
    // ignore
  } finally {
    worker = null;
  }
}

if (require.main === module) {
  startWebhookWorker();
  const shutdown = async () => {
    await stopWebhookWorker();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { startWebhookWorker, stopWebhookWorker, processor };
