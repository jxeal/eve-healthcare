'use strict';

const rateLimit = require('express-rate-limit');

function limitExceeded(req, res) {
  return res
    .status(429)
    .json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } });
}

// POST /auth/* — 20 requests / 15 min / IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceeded,
});

// POST /payments — 30 requests / min / user (fall back to IP pre-auth edge)
const paymentsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? req.user.id : req.ip),
  handler: limitExceeded,
});

// POST /payments/webhook — 100 requests / min / IP
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceeded,
});

module.exports = { authLimiter, paymentsLimiter, webhookLimiter };
