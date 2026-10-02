const request = require('supertest');
const { getApp } = require('./app');
const { prisma } = require('../../src/config/db');
const { hash } = require('../../src/utils/password');
const { issueToken } = require('../../src/modules/auth/auth.service');

const unique = (prefix = 'user') => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}@example.com`;

async function signupUser({ name = 'Test User', email, password = 'Password123!' } = {}) {
  const payload = { name, email: email || unique(), password };
  const res = await request(getApp()).post('/api/v1/auth/signup').send(payload);
  if (res.status !== 201) {
    throw new Error(`[signupUser] expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return { user: res.body.user, token: res.body.token, email: payload.email, password };
}

// Admins can't self-register, so create one directly.
async function createAdmin() {
  const user = await prisma.user.create({
    data: { name: 'Admin', email: unique('admin'), passwordHash: await hash('Admin123!'), role: 'ADMIN' },
  });
  return { user, token: issueToken(user) };
}

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { signupUser, createAdmin, authHeader, unique };
