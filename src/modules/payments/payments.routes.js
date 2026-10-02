'use strict';

const express = require('express');
const { auth } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { verifyWebhookSignature } = require('../../middlewares/webhookSignature');
const { paymentsLimiter, webhookLimiter } = require('../../middlewares/rateLimit');
const controller = require('./payments.controller');
const { createPaymentSchema, webhookSchema } = require('./payments.schemas');

const router = express.Router();

/**
 * @openapi
 * /payments:
 *   post:
 *     tags: [Payments]
 *     summary: Pay for a booking through the simulated gateway
 *     description: >
 *       Each call is a new payment attempt. A FAILED booking can be paid again; a booking with a
 *       PENDING attempt, a CONFIRMED booking or a CANCELLED booking cannot. Reusing an
 *       Idempotency-Key returns the original attempt without charging again.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: Idempotency-Key, in: header, required: false, schema: { type: string, maxLength: 128 } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingId]
 *             properties:
 *               bookingId: { type: string, format: uuid }
 *               simulate: { type: string, enum: [SUCCESS, FAILED, PENDING] }
 *               idempotencyKey: { type: string, description: Alternative to the header }
 *     responses:
 *       201: { description: Settled payment (SUCCESS or FAILED), content: { application/json: { schema: { $ref: '#/components/schemas/Payment' } } } }
 *       202: { description: 'Attempt still PENDING: the provider answers later, or the save is being retried by reconciliation' }
 *       200: { description: Idempotent replay of an existing attempt }
 *       403: { description: Not the booking owner }
 *       404: { description: Booking not found }
 *       409: { description: 'BOOKING_CANCELLED, PAYMENT_ALREADY_EXISTS, APPOINTMENT_PASSED or PAYMENT_IN_PROGRESS' }
 *       422: { description: Validation error or IDEMPOTENCY_KEY_REUSED for another booking }
 */
router.post('/', auth, paymentsLimiter, validate(createPaymentSchema), controller.createPayment);

/**
 * @openapi
 * /payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Provider status update (signed, idempotent per eventId)
 *     description: >
 *       Signature = hex HMAC-SHA256 of "{timestamp}.{raw body}" with WEBHOOK_SECRET. Timestamps
 *       older than WEBHOOK_TOLERANCE_SEC are rejected. Only PENDING payments change; events for
 *       settled payments return applied=false.
 *     parameters:
 *       - { name: X-Webhook-Timestamp, in: header, required: true, schema: { type: integer, description: Unix seconds } }
 *       - { name: X-Webhook-Signature, in: header, required: true, schema: { type: string } }
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
 *               status: { type: string, enum: [SUCCESS, FAILED] }
 *     responses:
 *       200: { description: '{ ok, deduped, applied }' }
 *       202: { description: 'Stored; processing failed and will be retried ({ ok, deduped, deferred: true })' }
 *       401: { description: Missing, invalid or stale signature }
 *       404: { description: Unknown payment reference (nothing stored) }
 *       422: { description: Malformed payload or mismatched references }
 */
router.post('/webhook', webhookLimiter, verifyWebhookSignature, validate(webhookSchema), controller.webhook);

/**
 * @openapi
 * /payments/{id}:
 *   get:
 *     tags: [Payments]
 *     summary: Get a payment attempt (booking owner only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payment }
 *       403: { description: Not the owner }
 *       404: { description: Payment not found }
 */
router.get('/:id', auth, controller.getPaymentById);

module.exports = router;
