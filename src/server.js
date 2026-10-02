'use strict';

const config = require('./config');
const logger = require('./utils/logger');
const { app } = require('./app');
const { startWebhookWorker } = require('./workers/webhook.worker');

startWebhookWorker();
app.listen(config.port, () => {
  logger.info({ event: 'server.start', port: config.port, env: config.env });
});
