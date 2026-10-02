'use strict';

const config = require('./config');
const logger = require('./utils/logger');
const { app } = require('./app');
const { prisma } = require('./config/db');
const { closeCache } = require('./config/redis');
const { closeQueue } = require('./queue/paymentJobs');
const { startWorker, stopWorker } = require('./workers/paymentJobs.worker');

// Below Docker's 10 s stop grace period, so we exit before SIGKILL.
const SHUTDOWN_TIMEOUT_MS = 8000;

startWorker();
const server = app.listen(config.port, () => {
  logger.info({ event: 'server.start', port: server.address().port, env: config.env });
});

function shutdown(signal) {
  logger.info({ event: 'server.shutdown', signal });
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  server.close(async () => {
    // In-flight jobs still need the database, so the worker stops before anything else closes.
    await stopWorker().catch((err) => logger.warn({ event: 'worker.stop_failed', err: err.message }));
    await Promise.allSettled([closeQueue(), prisma.$disconnect(), closeCache()]);
    process.exit(0);
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
