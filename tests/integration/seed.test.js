const path = require('path');
const { spawnSync } = require('child_process');
const { prisma } = require('../../src/config/db');
const { signupUser, unique } = require('../helpers/auth');

function runSeed(adminEmail) {
  return spawnSync(process.execPath, ['prisma/seed.js'], {
    cwd: path.join(__dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SEED_ADMIN_EMAIL: adminEmail,
      SEED_ADMIN_PASSWORD: 'Seeded-Admin-1',
    },
    encoding: 'utf8',
    timeout: 30000,
  });
}

describe('prisma/seed.js', () => {
  test('creates the admin when the email is unused, and re-running changes nothing', async () => {
    const email = unique('seed-admin');
    expect(runSeed(email).status).toBe(0);
    const admin = await prisma.user.findUnique({ where: { email } });
    expect(admin.role).toBe('ADMIN');

    expect(runSeed(email).status).toBe(0);
    expect((await prisma.user.findUnique({ where: { email } })).passwordHash).toBe(admin.passwordHash);
  });

  test('refuses to promote an account that registered the admin email first', async () => {
    const { user } = await signupUser({ email: unique('squatter') });
    const result = runSeed(user.email);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/existing non-admin account/);
    expect((await prisma.user.findUnique({ where: { id: user.id } })).role).toBe('USER');
  });
});
