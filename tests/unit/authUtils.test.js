const jwt = require('../../src/utils/jwt');
const password = require('../../src/utils/password');

describe('password utils', () => {
  test('hash + compare round-trip; wrong password fails', async () => {
    const hash = await password.hash('Password123!');
    expect(hash).not.toContain('Password123!');
    await expect(password.compare('Password123!', hash)).resolves.toBe(true);
    await expect(password.compare('Nope999!', hash)).resolves.toBe(false);
  });
});

describe('jwt utils', () => {
  test('sign + verify round-trip keeps sub and role', () => {
    const decoded = jwt.verify(jwt.sign({ sub: 'user-123', role: 'ADMIN' }));
    expect(decoded).toMatchObject({ sub: 'user-123', role: 'ADMIN' });
  });

  test('garbage token throws', () => {
    expect(() => jwt.verify('garbage.token.here')).toThrow();
  });
});
