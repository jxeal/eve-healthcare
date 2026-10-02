'use strict';

// Runs inside the API process (src/server.js) or standalone via `npm run worker`.
const { Worker } = require('bullmq');
const config = require('../config');
const logger = require('../utils/logger');
const { prisma } = require('../config/db');
const { QUEUE_NAME, JOBS, scheduleReconciliation, closeQueue } = require('../queue/paymentJobs');
const { createQueueConnection } = require('../queue/connection');
const webhookService = require('../modules/payments/webhook.service');
const reconciliation = require('../modules/payments/reconciliation.service');

async function processWebhookEvent(eventId) {
  try {
    return await webhookService.processWebhookEvent(eventId);
  } catch (err) {
    await webhookService.recordWebhookFailure(eventId, err);
    throw err;
  }
}

// Throwing hands the job back to BullMQ, which retries it with exponential backoff.
async function processor(job) {
  if (job.name === JOBS.PROCESS_WEBHOOK_EVENT) return processWebhookEvent(job.data.eventId);
  if (job.name === JOBS.RECONCILE) return reconciliation.runReconciliation();
  throw new Error(`Unknown job: ${job.name}`);
}

let worker = null;

function startWorker() {
  if (config.env === 'test' || worker) return worker;
  worker = new Worker(QUEUE_NAME, processor, { connection: createQueueConnection(), concurrency: 5 });
  worker.on('completed', (job) => logger.debug({ event: 'worker.completed', job: job.name, id: job.id }));
  worker.on('failed', (job, err) =>
    logger.warn({ event: 'worker.failed', job: job && job.name, attempts: job && job.attemptsMade, err: err.message }),
  );
  worker.on('error', (err) => logger.warn({ event: 'worker.error', err: err.message }));
  scheduleReconciliation().catch((err) => logger.warn({ event: 'worker.schedule_failed', err: err.message }));
  logger.info({ event: 'worker.start', queue: QUEUE_NAME });
  return worker;
}

async function stopWorker() {
  if (worker) await worker.close();
  worker = null;
}

if (require.main === module) {
  startWorker();
  const shutdown = async () => {
    await Promise.allSettled([stopWorker(), closeQueue(), prisma.$disconnect()]);
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = { startWorker, stopWorker, processor };
