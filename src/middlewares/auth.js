'use strict';

const { verify } = require('../utils/jwt');
const { ApiError } = require('../utils/errors');

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid authorization token'));
  }
  try {
    const decoded = verify(token);
    const id = decoded.sub || decoded.id || decoded.userId;
    if (!id) throw new Error('token has no subject');
    req.user = { id, email: decoded.email };
    return next();
  } catch {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
}

module.exports = { auth };
