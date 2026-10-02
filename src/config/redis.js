'use strict';

// Best-effort cache: every helper degrades to a miss or a no-op when Redis is down.
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

async function withClient(fn, fallback) {
  try {
    if (!(await ensureConnected())) return fallback;
    return await fn();
  } catch {
    return fallback;
  }
}

async function cached(key, ttlSec, load) {
  const hit = await withClient(async () => JSON.parse(await client.get(key)), null);
  if (hit) return hit;
  const value = await load();
  await withClient(() => client.set(key, JSON.stringify(value), 'EX', ttlSec));
  return value;
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

module.exports = { cached, cacheDel, cacheDelPattern, closeCache };
