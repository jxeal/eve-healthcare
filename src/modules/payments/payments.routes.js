'use strict';

const express = require('express');
const { auth } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { paymentsLimiter, webhookLimiter } = require('../../middlewares/rateLimit');
const controller = require('./payments.controller');
const { createPaymentSchema, webhookSchema } = require('./payments.schemas');

const router = express.Router();

/**
 * @openapi
 * /payments:
 *   post:
 *     summary: Pay for a booking (simulated gateway)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingId]
 *             properties:
 *               bookingId: { type: string, format: uuid }
 *               simulate: { type: string, enum: [SUCCESS, FAILED] }
 *               idempotencyKey: { type: string }
 *     responses:
 *       201: { description: Payment created }
 *       200: { description: Idempotent replay of an existing payment }
 *       409: { description: Booking already paid or cancelled }
 */
router.post('/', auth, paymentsLimiter, validate(createPaymentSchema), controller.createPayment);

/**
 * @openapi
 * /payments/{id}:
 *   get:
 *     summary: Get a payment (owner only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payment }
 *       403: { description: Not the owner }
 *       404: { description: Payment not found }
 */
router.get('/:id', auth, controller.getPaymentById);

/**
 * @openapi
 * /payments/webhook:
 *   post:
 *     summary: Provider webhook (public, rate-limited, idempotent)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [eventId, status]
 *             properties:
 *               eventId: { type: string }
 *               paymentId: { type: string, format: uuid }
 *               providerTxnId: { type: string }
 *               bookingId: { type: string, format: uuid }
 *               status: { type: string, enum: [SUCCESS, FAILED] }
 *     responses:
 *       200: { description: '{ ok: true, deduped: boolean }' }
 *       404: { description: Unknown payment reference }
 *       422: { description: Malformed payload }
 */
router.post('/webhook', webhookLimiter, validate(webhookSchema), controller.webhook);

module.exports = router;
module.exports.paymentsRoutes = router;
