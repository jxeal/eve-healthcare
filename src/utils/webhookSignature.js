'use strict';

const crypto = require('crypto');
const config = require('../config');

function signPayload(timestamp, rawBody, secret = config.webhookSecret) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

// Returns null when valid, otherwise the reason it was rejected.
function verifySignature({ timestamp, signature, rawBody, nowSec = Math.floor(Date.now() / 1000) }) {
  if (!timestamp || !signature || rawBody === undefined) return 'Missing webhook signature';
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSec - ts) > config.webhookToleranceSec) {
    return 'Webhook timestamp outside tolerance';
  }
  const expected = Buffer.from(signPayload(timestamp, rawBody), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return 'Invalid webhook signature';
  }
  return null;
}

module.exports = { signPayload, verifySignature };
