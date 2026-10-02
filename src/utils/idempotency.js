'use strict';

const crypto = require('crypto');

function normalizeKey(key) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('Idempotency key must be a non-empty string');
  }
  return crypto.createHash('sha256').update(key.trim().toLowerCase()).digest('hex');
}

// Keys are scoped per user so two users can never collide on the same key.
function scopedKey(userId, key) {
  return normalizeKey(`${userId}:${key}`);
}

module.exports = { normalizeKey, scopedKey };
