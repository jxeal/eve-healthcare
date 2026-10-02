'use strict';

// Retries webhook events whose processing failed. Runs inside the API process
// (src/server.js) or standalone via `npm run worker`.
const { Worker } = require('bullmq');
const config = require('../config');
const logger = require('../utils/logger');
const { QUEUE_NAME } = require('../queue/webhook.queue');
const { createQueueConnection } = require('../queue/connection');
const webhookService = require('../modules/payments/webhook.service');

// Rethrowing is what makes BullMQ apply attempts + exponential backoff.
async function processor(job) {
  const { eventId } = job.data;
  try {
    return await webhookService.processWebhookEvent(eventId);
  } catch (err) {
    await webhookService.recordWebhookFailure(eventId, err);
    throw err;
  }
}

let worker = null;

function startWebhookWorker() {
  if (config.env === 'test' || worker) return worker;
  worker = new Worker(QUEUE_NAME, processor, { connection: createQueueConnection(), concurrency: 5 });
  worker.on('completed', (job, result) => logger.info({ event: 'worker.completed', eventId: job.data.eventId, result }));
  worker.on('failed', (job, err) =>
    logger.warn({ event: 'worker.failed', eventId: job && job.data.eventId, attempts: job && job.attemptsMade, err: err.message })
  );
  worker.on('error', (err) => logger.warn({ event: 'worker.error', err: err.message }));
  logger.info({ event: 'worker.start', queue: QUEUE_NAME });
  return worker;
}

if (require.main === module) {
  startWebhookWorker();
  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { startWebhookWorker, processor };
