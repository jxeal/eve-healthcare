'use strict';

// Best-effort cache: every helper degrades to a miss / no-op when Redis is down.
const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

const client = new Redis(config.redisUrl, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 100, 2000),
});
client.on('error', (err) => logger.warn({ event: 'redis.error', err: err.message }));

async function ensureConnected() {
  try {
    if (['ready', 'connect', 'connecting'].includes(client.status)) return true;
    await client.connect();
    return true;
  } catch {
    return false;
  }
}

// An open socket keeps jest alive, so under test drop it after a short idle window.
let idleTimer = null;
function scheduleIdleDisconnect() {
  if (config.env !== 'test') return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (client.status === 'ready') client.disconnect();
  }, 500);
  idleTimer.unref();
}

async function withClient(fn, fallback) {
  try {
    if (!(await ensureConnected())) return fallback;
    const result = await fn();
    scheduleIdleDisconnect();
    return result;
  } catch {
    return fallback;
  }
}

async function cacheGet(key) {
  return withClient(async () => {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  }, null);
}

async function cacheSet(key, value, ttlSec = 60) {
  return withClient(() => client.set(key, JSON.stringify(value), 'EX', ttlSec));
}

async function cacheDel(...keys) {
  return withClient(() => client.del(...keys));
}

async function cacheDelPattern(pattern) {
  return withClient(async () => {
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      if (keys.length) await client.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  });
}

function closeCache() {
  client.disconnect();
}

module.exports = { cacheGet, cacheSet, cacheDel, cacheDelPattern, closeCache };
