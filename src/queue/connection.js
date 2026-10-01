'use strict';

// Shared BullMQ connection factory.
//
// BullMQ requires its own ioredis connections with
// `maxRetriesPerRequest: null` (blocking clients). This is separate from
// the best-effort cache client in config/redis.js. Connections are created
// lazily and only outside the test env (under jest an open socket would
// keep the event loop alive) — see queue/webhook.queue.js and
// workers/webhook.worker.js.
const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

function createQueueConnection() {
  const conn = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  conn.on('error', (err) => logger.warn({ event: 'queue.redis_error', err: err && err.message }));
  return conn;
}

module.exports = { createQueueConnection };
