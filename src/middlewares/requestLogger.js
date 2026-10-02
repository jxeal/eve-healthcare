'use strict';

const pinoHttp = require('pino-http');
const config = require('../config');
const logger = require('../utils/logger');

module.exports = pinoHttp({ logger, autoLogging: config.env !== 'test' });
