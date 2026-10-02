const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');

// The request logger is off under NODE_ENV=test, so run one request in a child process.
function requestLogLine(headers) {
  const script = `
    const http = require('http');
    const { app } = require('./src/app');
    const server = app.listen(0, () => {
      const req = http.request({ port: server.address().port, path: '/api/v1/auth/me', headers: ${JSON.stringify(headers)} }, (res) => {
        res.resume();
        res.on('end', () => setTimeout(() => process.exit(0), 50));
      });
      req.end();
    });`;
  const { stdout } = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'info' },
    encoding: 'utf8',
    timeout: 15000,
  });
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((line) => line.req && line.req.url === '/api/v1/auth/me');
}

test('request logs redact the bearer token and webhook signature', () => {
  const line = requestLogLine({ Authorization: 'Bearer secret-token-123', 'X-Webhook-Signature': 'cafebabe' });
  expect(line).toBeDefined();
  expect(line.req.headers.authorization).toBe('[REDACTED]');
  expect(line.req.headers['x-webhook-signature']).toBe('[REDACTED]');
  expect(JSON.stringify(line)).not.toMatch(/secret-token-123|cafebabe/);
});
