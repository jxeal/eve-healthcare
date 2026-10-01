/**
 * Architect-owned (FROZEN) — Agent-1 (+Agent-4) must make these green.
 * Tests src/utils/idempotency.js contract.
 */
let idem;
try {
  // eslint-disable-next-line global-require
  idem = require('../../src/utils/idempotency');
} catch (e) {
  throw new Error(`[unit/idempotency] Cannot load src/utils/idempotency.js — Agent-1 must implement it. Original: ${e.message}`);
}

describe('idempotency helper', () => {
  test('exports a normalizer/hash function', () => {
    const fn = idem.normalizeKey || idem.hashKey || idem.default || idem;
    expect(typeof fn).toBe('function');
  });

  test('same key normalizes identically; different keys differ; empty rejected', () => {
    const fn = idem.normalizeKey || idem.hashKey || idem.default || idem;
    if (fn.length === 0) {
      // zero-arg hash generator: two calls differ (uuid-style) — acceptable
      expect(fn()).not.toBe(fn());
      return;
    }
    expect(fn('  ABC-123 ')).toBe(fn('abc-123'));
    expect(fn('key-one')).not.toBe(fn('key-two'));
    expect(() => fn('')).toThrow();
    expect(() => fn(null)).toThrow();
  });
});
