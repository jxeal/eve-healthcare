'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/errors');
const service = require('./payments.service');
const webhookService = require('./webhook.service');
const { idempotencyKey } = require('./payments.schemas');

function readIdempotencyKey(req) {
  const raw = req.get('Idempotency-Key') ?? req.body.idempotencyKey;
  if (raw === undefined) return null;
  const parsed = idempotencyKey.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid idempotency key', [
      { path: 'Idempotency-Key', message: parsed.error.issues[0].message },
    ]);
  }
  return parsed.data;
}

function paymentStatusCode(payment, replay) {
  if (replay) return 200;
  return payment.status === 'PENDING' ? 202 : 201;
}

const createPayment = asyncHandler(async (req, res) => {
  const { payment, replay } = await service.createPayment(req.user.id, {
    bookingId: req.body.bookingId,
    simulate: req.body.simulate,
    idempotencyKey: readIdempotencyKey(req),
  });
  return res.status(paymentStatusCode(payment, replay)).json(payment);
});

const getPaymentById = asyncHandler(async (req, res) =>
  res.status(200).json(await service.getPaymentById(req.user.id, req.params.id)),
);

const webhook = asyncHandler(async (req, res) => {
  const result = await webhookService.receiveWebhook(req.body, JSON.parse(req.rawBody));
  return res.status(result.deferred ? 202 : 200).json(result);
});

module.exports = { createPayment, getPaymentById, webhook };
