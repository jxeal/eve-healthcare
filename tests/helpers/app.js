/**
 * Architect-owned (FROZEN) test helper.
 * Single import point for the Express app so tests fail with a CLEAR
 * message until Agent-1 implements src/app.js.
 */
let cached = null;

function getApp() {
  if (cached) return cached;
  try {
    // Agent-1 MUST export either `app` or `createApp()` from src/app.js
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require('../../src/app');
    cached = mod.app || mod.createApp?.() || mod.default || mod;
  } catch (err) {
    throw new Error(
      `[tests/helpers/app] Cannot load src/app.js — Agent-1 has not implemented it yet.\nOriginal: ${err.message}\nExpected: src/app.js exporting { app } (express instance, no app.listen inside).`
    );
  }
  if (!cached || typeof cached !== 'function') {
    throw new Error('[tests/helpers/app] src/app.js did not export an express app function.');
  }
  return cached;
}

module.exports = { getApp };
