'use strict';

const { verifySignature } = require('../utils/webhookSignature');
const { ApiError } = require('../utils/errors');

function verifyWebhookSignature(req, res, next) {
  const reason = verifySignature({
    timestamp: req.get('X-Webhook-Timestamp'),
    signature: req.get('X-Webhook-Signature'),
    rawBody: req.rawBody,
  });
  return reason ? next(new ApiError(401, 'INVALID_SIGNATURE', reason)) : next();
}

module.exports = { verifyWebhookSignature };
