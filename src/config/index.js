'use strict';

require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

function int(name, fallback) {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

function secret(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (env === 'production') throw new Error(`${name} must be set in production`);
  return devFallback;
}

module.exports = {
  env,
  port: int('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: secret('JWT_SECRET', 'dev-jwt-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  webhookSecret: secret('WEBHOOK_SECRET', 'dev-webhook-secret'),
  webhookToleranceSec: int('WEBHOOK_TOLERANCE_SEC', 300),
  rateLimit: {
    authMax: int('RATE_LIMIT_AUTH_MAX', 20),
    paymentsMax: int('RATE_LIMIT_PAYMENTS_MAX', 30),
    webhookMax: int('RATE_LIMIT_WEBHOOK_MAX', 100),
  },
};
