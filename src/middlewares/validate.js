'use strict';

const { ApiError } = require('../utils/errors');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
      return next(new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', details));
    }
    req[source] = result.data;
    return next();
  };
}

module.exports = { validate };
