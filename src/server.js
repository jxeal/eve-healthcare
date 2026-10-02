'use strict';

const config = require('./config');
const logger = require('./utils/logger');
const { app } = require('./app');
const { prisma } = require('./config/db');
const { closeCache } = require('./config/redis');
const { closeQueue } = require('./queue/paymentJobs');
const { startWorker, stopWorker } = require('./workers/paymentJobs.worker');

// Under Docker's default 10 s stop grace period, so we exit before SIGKILL.
const SHUTDOWN_TIMEOUT_MS = 8000;

startWorker();
const server = app.listen(config.port, () => {
  logger.info({ event: 'server.start', port: server.address().port, env: config.env });
});

function shutdown(signal) {
  logger.info({ event: 'server.shutdown', signal });
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  server.close(async () => {
    await Promise.allSettled([stopWorker(), closeQueue(), prisma.$disconnect(), closeCache()]);
    process.exit(0);
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
