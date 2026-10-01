'use strict';

// Null-safe Redis client. All cache helpers degrade gracefully (return
// null / no-op) when Redis is down so requests fall through to the DB.
const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

let client = null;
try {
  client = new Redis(config.redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 100, 2000),
  });
  client.on('error', (err) => logger.warn({ event: 'redis.error', err: err && err.message }));
} catch (err) {
  logger.warn({ event: 'redis.init_failed', err: err && err.message });
  client = null;
}

async function isRedisUp() {
  try {
    if (!(await ensureConnected())) return false;
    const pong = await client.ping();
    scheduleIdleDisconnect();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

async function ensureConnected() {
  try {
    if (!client) return false;
    if (client.status === 'ready') return true;
    if (client.status === 'connect' || client.status === 'connecting') return true;
    await client.connect();
    return true;
  } catch {
    return false;
  }
}

// Under jest the open Redis socket keeps the event loop alive, so `npm
// test` (no --forceExit) would never exit. In test env only, drop the
// connection after a short idle window via an unref'd timer (the timer
// itself never blocks exit); the next cache op transparently reconnects.
let idleTimer = null;
function scheduleIdleDisconnect() {
  if (!client || process.env.NODE_ENV !== 'test') return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    try {
      if (client.status === 'ready') client.disconnect();
    } catch {
      // ignore
    }
  }, 500);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

async function cacheGet(key) {
  try {
    if (!(await ensureConnected())) return null;
    const raw = await client.get(key);
    scheduleIdleDisconnect();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttlSec = 60) {
  try {
    if (!(await ensureConnected())) return;
    await client.set(key, JSON.stringify(value), 'EX', ttlSec);
    scheduleIdleDisconnect();
  } catch {
    // ignore — cache is best-effort
  }
}

async function cacheDelPattern(pattern) {
  try {
    if (!(await ensureConnected())) return;
    const keys = await client.keys(pattern);
    if (keys && keys.length) await client.del(...keys);
    scheduleIdleDisconnect();
  } catch {
    // ignore — cache is best-effort
  }
}

module.exports = { redis: client, isRedisUp, cacheGet, cacheSet, cacheDelPattern };
