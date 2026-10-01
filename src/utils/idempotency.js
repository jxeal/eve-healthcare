'use strict';

const crypto = require('crypto');

// Normalizes an idempotency key (trim + lowercase) and returns a stable
// sha256 digest so stored keys are uniform regardless of client casing.
function normalizeKey(key) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('Idempotency key must be a non-empty string');
  }
  return crypto.createHash('sha256').update(key.trim().toLowerCase()).digest('hex');
}

module.exports = { normalizeKey, hashKey: normalizeKey };
