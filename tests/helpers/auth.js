/**
 * Architect-owned (FROZEN) test helper — auth flows.
 */
const request = require('supertest');
const { getApp } = require('./app');

const unique = (prefix = 'user') =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}@example.com`;

/** Sign up a fresh user, return { user, token, email, password }. */
async function signupUser({ name = 'Test User', email, password = 'Password123!' } = {}) {
  const app = getApp();
  const payload = { name, email: email || unique(), password };
  const res = await request(app).post('/api/v1/auth/signup').send(payload);
  if (res.status !== 201) {
    throw new Error(
      `[signupUser] expected 201, got ${res.status}: ${JSON.stringify(res.body)} (payload=${JSON.stringify({ ...payload, password: '***' })})`
    );
  }
  return { user: res.body.user, token: res.body.token, email: payload.email, password };
}

/** Log in, return { user, token }. */
async function loginUser(email, password) {
  const app = getApp();
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res;
}

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { signupUser, loginUser, authHeader, unique };
