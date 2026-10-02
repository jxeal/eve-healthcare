'use strict';

const { prisma } = require('../config/db');
const { verify } = require('../utils/jwt');
const { ApiError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

function auth(req, res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!match) return next(new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid authorization token'));
  try {
    const { sub, email } = verify(match[1]);
    if (!sub) throw new Error('token has no subject');
    req.user = { id: sub, email };
    return next();
  } catch {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
}

// Read from the database, not the token, so a role change applies on the next request.
function requireRole(role) {
  return asyncHandler(async (req, res, next) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
    if (!user || user.role !== role) throw new ApiError(403, 'FORBIDDEN', `Requires ${role} role`);
    next();
  });
}

module.exports = { auth, requireRole };
