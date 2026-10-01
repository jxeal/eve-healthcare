/**
 * Architect-owned (FROZEN) — Agent-1 must make these green.
 * Tests src/utils/jwt.js + src/utils/password.js contracts.
 */
let jwt, password;
try {
  // eslint-disable-next-line global-require
  jwt = require('../../src/utils/jwt');
} catch (e) {
  throw new Error(`[unit/authUtils] Cannot load src/utils/jwt.js — Agent-1 must implement it. Original: ${e.message}`);
}
try {
  // eslint-disable-next-line global-require
  password = require('../../src/utils/password');
} catch (e) {
  throw new Error(`[unit/authUtils] Cannot load src/utils/password.js — Agent-1 must implement it. Original: ${e.message}`);
}

describe('password utils (bcryptjs)', () => {
  test('hash + compare round-trip; wrong password fails', async () => {
    const hash = await password.hash('Password123!');
    expect(hash).not.toContain('Password123!');
    await expect(password.compare('Password123!', hash)).resolves.toBe(true);
    await expect(password.compare('Nope999!', hash)).resolves.toBe(false);
  });
});

describe('jwt utils', () => {
  test('sign + verify round-trip exposes sub', () => {
    const sign = jwt.sign || jwt.signToken || jwt.default?.sign;
    const verify = jwt.verify || jwt.verifyToken || jwt.default?.verify;
    expect(typeof sign).toBe('function');
    expect(typeof verify).toBe('function');
    const token = sign({ sub: 'user-123', email: 'a@b.c' });
    expect(typeof token).toBe('string');
    const decoded = verify(token);
    expect(decoded.sub || decoded.id || decoded.userId).toBeTruthy();
  });

  test('garbage token throws (does not return null)', () => {
    const verify = jwt.verify || jwt.verifyToken || jwt.default?.verify;
    expect(() => verify('garbage.token.here')).toThrow();
  });
});
