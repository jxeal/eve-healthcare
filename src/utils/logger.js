'use strict';

const pino = require('pino');

// JSON logs. Silent under jest so test output stays readable; the call
// sites still emit fully structured events in real environments.
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
});

module.exports = logger;
