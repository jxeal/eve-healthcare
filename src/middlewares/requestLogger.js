'use strict';

const pinoHttp = require('pino-http');
const logger = require('../utils/logger');

module.exports = pinoHttp({
  logger,
  autoLogging: process.env.NODE_ENV !== 'test',
});
