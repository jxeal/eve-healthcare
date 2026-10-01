'use strict';

const service = require('./payments.service');
const webhookService = require('./webhook.service');

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const createPayment = ah(async (req, res) => {
  const key = (req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim() || null;
  const { payment, replay } = await service.createPayment(req.user.id, {
    bookingId: req.body.bookingId,
    simulate: req.body.simulate,
    idempotencyKey: key,
  });
  return res.status(replay ? 200 : 201).json(payment);
});

const getPaymentById = ah(async (req, res) => {
  const payment = await service.getPaymentById(req.user.id, req.params.id);
  return res.status(200).json(payment);
});

const webhook = ah(async (req, res) => {
  const result = await webhookService.handleWebhook({ ...req.body, payload: req.body });
  return res.status(200).json(result);
});

module.exports = { createPayment, getPaymentById, webhook };
