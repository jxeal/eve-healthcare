const { normalizeKey, scopedKey } = require('../../src/utils/idempotency');

describe('idempotency keys', () => {
  test('normalizes case and whitespace; different keys differ; empty rejected', () => {
    expect(normalizeKey('  ABC-123 ')).toBe(normalizeKey('abc-123'));
    expect(normalizeKey('key-one')).not.toBe(normalizeKey('key-two'));
    expect(() => normalizeKey('')).toThrow();
    expect(() => normalizeKey(null)).toThrow();
  });

  test('scopes the same key per user', () => {
    expect(scopedKey('user-a', 'order-1')).toBe(scopedKey('user-a', 'order-1'));
    expect(scopedKey('user-a', 'order-1')).not.toBe(scopedKey('user-b', 'order-1'));
  });
});
