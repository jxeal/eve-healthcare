'use strict';

const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err && err.code === 'P2002') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate resource' } });
  }
  if (err && err.code === 'P2025') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
  }
  const status = err.statusCode || err.status || 500;
  const code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR');
  const message = status === 500 ? 'Internal server error' : err.message || 'Something went wrong';
  if (status === 500) logger.error({ event: 'unhandled_error', err: err && err.message });
  const body = { error: { code, message } };
  if (err.details) body.error.details = err.details;
  return res.status(status).json(body);
}

function notFound(req, res) {
  return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

module.exports = { errorHandler, notFound };
