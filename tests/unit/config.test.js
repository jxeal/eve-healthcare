function loadConfig(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key];
  try {
    let config;
    jest.isolateModules(() => {
      jest.doMock('dotenv', () => ({ config: () => ({}) }));
      config = require('../../src/config');
    });
    return config;
  } finally {
    process.env = saved;
  }
}

describe('config secrets', () => {
  test('production refuses to start without JWT_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: undefined, WEBHOOK_SECRET: 'w'.repeat(32) })).toThrow(
      /JWT_SECRET/,
    );
  });

  test('production refuses to start without WEBHOOK_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'j'.repeat(32), WEBHOOK_SECRET: undefined })).toThrow(
      /WEBHOOK_SECRET/,
    );
  });

  test('production rejects secrets shorter than 32 characters', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short', WEBHOOK_SECRET: 'w'.repeat(32) })).toThrow(
      /JWT_SECRET must be at least 32/,
    );
  });

  test('production accepts long secrets', () => {
    const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'j'.repeat(32), WEBHOOK_SECRET: 'w'.repeat(32) });
    expect(config.jwtSecret).toBe('j'.repeat(32));
  });

  test('development falls back to local defaults', () => {
    const config = loadConfig({ NODE_ENV: 'development', JWT_SECRET: undefined, WEBHOOK_SECRET: undefined });
    expect(config.jwtSecret).toBeTruthy();
    expect(config.webhookSecret).toBeTruthy();
  });
});
