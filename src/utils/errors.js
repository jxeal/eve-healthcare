'use strict';

class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const validationError = (message = 'Validation failed', details) =>
  new ApiError(422, 'VALIDATION_ERROR', message, details);
const unauthorized = (message = 'Unauthorized') => new ApiError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'Forbidden') => new ApiError(403, 'FORBIDDEN', message);
const notFound = (message = 'Resource not found') => new ApiError(404, 'NOT_FOUND', message);
const conflict = (code = 'CONFLICT', message = 'Conflict') => new ApiError(409, code, message);

module.exports = { ApiError, validationError, unauthorized, forbidden, notFound, conflict };
