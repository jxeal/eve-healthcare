const request = require('supertest');

// Loads a separate copy of the app with its own config and rate-limit counters.
function loadAppWith(env) {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  let app;
  jest.isolateModules(() => {
    ({ app } = require('../../src/app'));
  });
  Object.assign(process.env, saved);
  return app;
}

async function loginStatuses(app, clientIp, count) {
  const server = app.listen(0);
  const statuses = [];
  for (let i = 0; i < count; i += 1) {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', clientIp)
      .send({ email: 'nobody@example.com', password: 'x' });
    statuses.push(res.status);
  }
  await new Promise((resolve) => server.close(resolve));
  return statuses;
}

describe('TRUST_PROXY', () => {
  test('with TRUST_PROXY=1, rate limits key on the client IP behind the proxy', async () => {
    const app = loadAppWith({ TRUST_PROXY: '1', RATE_LIMIT_AUTH_MAX: '2' });
    expect(await loginStatuses(app, '203.0.113.1', 3)).toEqual([401, 401, 429]);
    expect(await loginStatuses(app, '203.0.113.2', 1)).toEqual([401]);
  });

  test('without it, every client behind the proxy shares one bucket', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const app = loadAppWith({ TRUST_PROXY: '', RATE_LIMIT_AUTH_MAX: '2' });
    expect(await loginStatuses(app, '203.0.113.1', 2)).toEqual([401, 401]);
    expect(await loginStatuses(app, '203.0.113.2', 1)).toEqual([429]);
    jest.restoreAllMocks();
  });
});
