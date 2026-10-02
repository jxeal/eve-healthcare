'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

function limitExceeded(req, res) {
  return res
    .status(429)
    .json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } });
}

const limiter = (options) =>
  rateLimit({ standardHeaders: true, legacyHeaders: false, handler: limitExceeded, ...options });

const authLimiter = limiter({ windowMs: 15 * 60 * 1000, max: config.rateLimit.authMax });

// Mounted after auth, so limits are per user rather than per IP.
const paymentsLimiter = limiter({
  windowMs: 60 * 1000,
  max: config.rateLimit.paymentsMax,
  keyGenerator: (req) => req.user.id,
});

const webhookLimiter = limiter({ windowMs: 60 * 1000, max: config.rateLimit.webhookMax });

module.exports = { authLimiter, paymentsLimiter, webhookLimiter };
