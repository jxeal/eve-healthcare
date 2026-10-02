'use strict';

const { verify } = require('../utils/jwt');
const { ApiError } = require('../utils/errors');

function auth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid authorization token'));
  }
  try {
    const { sub, email, role } = verify(token);
    if (!sub) throw new Error('token has no subject');
    req.user = { id: sub, email, role };
    return next();
  } catch {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
}

function requireRole(role) {
  return (req, res, next) =>
    req.user && req.user.role === role
      ? next()
      : next(new ApiError(403, 'FORBIDDEN', `Requires ${role} role`));
}

module.exports = { auth, requireRole };
