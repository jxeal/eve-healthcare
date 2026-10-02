'use strict';

const { prisma } = require('../../config/db');
const { hash, compare } = require('../../utils/password');
const { sign } = require('../../utils/jwt');
const { ApiError } = require('../../utils/errors');

function toPublic(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
}

function issueToken(user) {
  return sign({ sub: user.id, email: user.email });
}

async function signup({ name, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(409, 'CONFLICT', 'Email already registered');
  const user = await prisma.user.create({ data: { name, email, passwordHash: await hash(password) } });
  return { user: toPublic(user), token: issueToken(user) };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await compare(password, user.passwordHash))) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid credentials');
  }
  return { user: toPublic(user), token: issueToken(user) };
}

async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'User not found');
  return { user: toPublic(user) };
}

module.exports = { signup, login, me, issueToken };
