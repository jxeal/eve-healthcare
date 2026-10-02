'use strict';

const logger = require('../utils/logger');
const { ApiError } = require('../utils/errors');

function send(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ error });
}

// Express identifies error middleware by its four parameters, so _next must stay.
function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) return send(res, err.statusCode, err.code, err.message, err.details);
  if (err.code === 'P2002') return send(res, 409, 'CONFLICT', 'Duplicate resource');
  if (err.code === 'P2025') return send(res, 404, 'NOT_FOUND', 'Resource not found');
  if (err.type === 'entity.parse.failed') return send(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (err.type === 'entity.too.large') return send(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (err.expose && err.status >= 400 && err.status < 500) return send(res, err.status, 'BAD_REQUEST', err.message);
  logger.error({ event: 'unhandled_error', err });
  return send(res, 500, 'INTERNAL_ERROR', 'Internal server error');
}

function notFound(req, res) {
  return send(res, 404, 'NOT_FOUND', 'Route not found');
}

module.exports = { errorHandler, notFound };
