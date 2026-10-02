const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const request = require('supertest');
const { prisma } = require('../../src/config/db');
const { createAdmin, authHeader, unique } = require('../helpers/auth');
const { futureISO } = require('../helpers/assert');

const ROOT = path.join(__dirname, '../..');

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let child;

afterEach(() => {
  if (child && child.exitCode === null) child.kill('SIGKILL');
});

test('SIGTERM lets an in-flight payment finish before the process exits', async () => {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  child = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port) } });
  const exitCode = new Promise((resolve) => child.once('exit', resolve));
  await waitFor(async () => (await request(base).get('/health').catch(() => ({}))).status === 200);

  const { token: adminToken } = await createAdmin();
  const signup = await request(base).post('/api/v1/auth/signup').send({ name: 'S', email: unique(), password: 'Password123!' });
  const userAuth = authHeader(signup.body.token);
  const centre = await request(base).post('/api/v1/centres').set(authHeader(adminToken)).send({ name: `Shutdown_${Date.now()}`, location: 'Pune' });
  const diagTest = await request(base)
    .post(`/api/v1/centres/${centre.body.id}/tests`)
    .set(authHeader(adminToken))
    .send({ name: 'CBC', price: 100 });
  const booking = await request(base)
    .post('/api/v1/bookings')
    .set(userAuth)
    .send({ centreId: centre.body.id, testId: diagTest.body.id, appointmentAt: futureISO() });

  const paying = request(base)
    .post('/api/v1/payments')
    .set(userAuth)
    .send({ bookingId: booking.body.id, simulate: 'SUCCESS' })
    .then((res) => res);
  // The attempt row exists from the moment the request is between claiming and charging.
  await waitFor(async () => (await prisma.payment.count({ where: { bookingId: booking.body.id } })) === 1);
  child.kill('SIGTERM');

  const res = await paying;
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('SUCCESS');
  expect(await exitCode).toBe(0);
  expect(await prisma.payment.findFirst({ where: { bookingId: booking.body.id } })).toMatchObject({ status: 'SUCCESS' });
});
