'use strict';

const { prisma } = require('../../config/db');
const { hash, compare } = require('../../utils/password');
const { sign } = require('../../utils/jwt');
const { ApiError } = require('../../utils/errors');

function toPublic(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

async function signup({ name, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(409, 'CONFLICT', 'Email already registered');
  const passwordHash = await hash(password);
  const user = await prisma.user.create({ data: { name, email, passwordHash } });
  const token = sign({ sub: user.id, email: user.email });
  return { user: toPublic(user), token };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid credentials');
  const ok = await compare(password, user.passwordHash);
  if (!ok) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid credentials');
  const token = sign({ sub: user.id, email: user.email });
  return { user: toPublic(user), token };
}

async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'User not found');
  return { user: toPublic(user) };
}

module.exports = { signup, login, me };
