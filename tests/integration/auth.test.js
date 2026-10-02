const request = require('supertest');
const { getApp } = require('../helpers/app');
const { signupUser, authHeader, unique } = require('../helpers/auth');
const { expectErrorShape } = require('../helpers/assert');
const { prisma } = require('../../src/config/db');

describe('Auth — POST /api/v1/auth/signup', () => {
  test('creates user, returns 201 with user + token, never leaks password', async () => {
    const app = getApp();
    const email = unique();
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Asha Verma', email, password: 'Password123!' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe(email);
    expect(res.body.user).toHaveProperty('id');
    expect(typeof res.body.token).toBe('string');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password/i);
  });

  test('duplicate email → 409 CONFLICT', async () => {
    const app = getApp();
    const email = unique();
    await request(app).post('/api/v1/auth/signup').send({ name: 'Dup', email, password: 'Password123!' });
    const res = await request(app).post('/api/v1/auth/signup').send({ name: 'Dup2', email, password: 'Password123!' });
    expectErrorShape(res, 409);
  });

  test('invalid email → 422 VALIDATION_ERROR', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/auth/signup').send({ name: 'Bad', email: 'not-an-email', password: 'Password123!' });
    expectErrorShape(res, 422);
  });

  test('short password (<6) → 422', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/auth/signup').send({ name: 'Short', email: unique(), password: '123' });
    expectErrorShape(res, 422);
  });

  test('missing name → 422', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/auth/signup').send({ email: unique(), password: 'Password123!' });
    expectErrorShape(res, 422);
  });
});

describe('Auth — POST /api/v1/auth/login', () => {
  test('login with correct credentials → 200 user + token', async () => {
    const app = getApp();
    const { email, password } = await signupUser();
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe(email);
  });

  test('wrong password → 401 (no user enumeration detail)', async () => {
    const app = getApp();
    const { email } = await signupUser();
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'WrongPass999!' });
    expectErrorShape(res, 401);
  });

  test('unknown email → 401', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/auth/login').send({ email: unique(), password: 'Password123!' });
    expectErrorShape(res, 401);
  });

  test('missing fields → 422', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/auth/login').send({ email: unique() });
    expectErrorShape(res, 422);
  });
});

describe('Auth — GET /api/v1/auth/me', () => {
  test('valid token → 200 current user', async () => {
    const app = getApp();
    const { token, email } = await signupUser();
    const res = await request(app).get('/api/v1/auth/me').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  test('no token → 401', async () => {
    const app = getApp();
    const res = await request(app).get('/api/v1/auth/me');
    expectErrorShape(res, 401);
  });

  test('garbage token → 401', async () => {
    const app = getApp();
    const res = await request(app).get('/api/v1/auth/me').set(authHeader('garbage.token.here'));
    expectErrorShape(res, 401);
  });
});

describe('Auth — email normalisation and roles', () => {
  test('email is case-insensitive: signup with different case → 409', async () => {
    const email = unique('Case');
    await signupUser({ email });
    const res = await request(getApp())
      .post('/api/v1/auth/signup')
      .send({ name: 'Upper', email: email.toUpperCase(), password: 'Password123!' });
    expectErrorShape(res, 409, 'CONFLICT');
  });

  test('login works regardless of email case and surrounding spaces', async () => {
    const { email, password } = await signupUser({ email: unique('Mixed') });
    const res = await request(getApp())
      .post('/api/v1/auth/login')
      .send({ email: `  ${email.toUpperCase()} `, password });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email.toLowerCase());
  });

  test('the database itself rejects an email differing only in case', async () => {
    const { email } = await signupUser();
    await expect(
      prisma.user.create({ data: { name: 'Dup', email: email.toUpperCase(), passwordHash: 'x' } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('the Bearer scheme is case-insensitive', async () => {
    const { token } = await signupUser();
    const res = await request(getApp()).get('/api/v1/auth/me').set('Authorization', `bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('self-registered accounts are USER, never ADMIN', async () => {
    const res = await request(getApp())
      .post('/api/v1/auth/signup')
      .send({ name: 'Sneaky', email: unique(), password: 'Password123!', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('USER');
  });
});
