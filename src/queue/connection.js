'use strict';

const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

// BullMQ needs its own blocking connections (maxRetriesPerRequest: null), separate from the cache client.
function createQueueConnection() {
  const conn = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  conn.on('error', (err) => logger.warn({ event: 'queue.redis_error', err: err.message }));
  return conn;
}

module.exports = { createQueueConnection };
