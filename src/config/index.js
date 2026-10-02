'use strict';

require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

function int(name, fallback) {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

// Express "trust proxy" accepts a hop count, true, or a list of trusted proxy addresses.
function trustProxy(raw) {
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

const MIN_SECRET_LENGTH = 32;

function secret(name, devFallback) {
  const value = process.env[name];
  if (env !== 'production') return value || devFallback;
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }
  return value;
}

module.exports = {
  env,
  port: int('PORT', 3000),
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: secret('JWT_SECRET', 'dev-jwt-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  webhookSecret: secret('WEBHOOK_SECRET', 'dev-webhook-secret'),
  webhookToleranceSec: int('WEBHOOK_TOLERANCE_SEC', 300),
  reconcile: {
    intervalSec: int('RECONCILE_INTERVAL_SEC', 60),
    staleAfterSec: int('PAYMENT_STALE_AFTER_SEC', 120),
    pendingExpirySec: int('PAYMENT_PENDING_EXPIRY_SEC', 1800),
    webhookRetryAfterSec: int('WEBHOOK_RETRY_AFTER_SEC', 60),
  },
  rateLimit: {
    authMax: int('RATE_LIMIT_AUTH_MAX', 20),
    paymentsMax: int('RATE_LIMIT_PAYMENTS_MAX', 30),
    webhookMax: int('RATE_LIMIT_WEBHOOK_MAX', 100),
  },
};
