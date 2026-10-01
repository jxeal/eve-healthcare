'use strict';

require('dotenv').config();
const config = require('./config');
const logger = require('./utils/logger');
const { app } = require('./app');
const { prisma } = require('./config/db');

async function start() {
  try {
    await prisma.$connect();
    logger.info({ event: 'db.connected' });
  } catch (err) {
    logger.warn({ event: 'db.connect_failed', err: err && err.message });
  }
  if (config.env !== 'test') {
    try {
      // eslint-disable-next-line global-require
      require('./workers/webhook.worker').startWebhookWorker();
    } catch (err) {
      logger.warn({ event: 'worker.start_failed', err: err && err.message });
    }
  }
  app.listen(config.port, () => {
    logger.info({ event: 'server.start', port: config.port, env: config.env });
  });
}

if (require.main === module) {
  start();
}

module.exports = { start, app };
