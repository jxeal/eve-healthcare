'use strict';

const express = require('express');
const { auth } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const controller = require('./bookings.controller');
const { createBookingSchema } = require('./bookings.schemas');

const router = express.Router();

router.use(auth);

/**
 * @openapi
 * /bookings:
 *   post:
 *     tags: [Bookings]
 *     summary: Book a test. Amount is a snapshot of the test price; status starts PENDING.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [centreId, testId, appointmentAt]
 *             properties:
 *               centreId: { type: string, format: uuid }
 *               testId: { type: string, format: uuid }
 *               appointmentAt: { type: string, format: date-time, description: Must be in the future }
 *     responses:
 *       201: { description: Booking }
 *       404: { description: Centre or test not found }
 *       422: { description: Validation error, test from another centre, or retired test }
 *   get:
 *     tags: [Bookings]
 *     summary: Own bookings, newest first
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 10, maximum: 100 } }
 *     responses:
 *       200: { description: '{ data: Booking[], pagination }' }
 */
router.post('/', validate(createBookingSchema), controller.create);
router.get('/', controller.list);

/**
 * @openapi
 * /bookings/{id}:
 *   get:
 *     tags: [Bookings]
 *     summary: One booking with centre, test and every payment attempt (owner only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Booking }
 *       403: { description: Not the owner }
 *       404: { description: Booking not found }
 */
router.get('/:id', controller.getById);

/**
 * @openapi
 * /bookings/{id}/cancel:
 *   post:
 *     tags: [Bookings]
 *     summary: Cancel a PENDING, FAILED or CONFIRMED booking. A captured payment is marked REFUNDED.
 *     description: A CONFIRMED booking can't be cancelled once its appointment time has passed.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Booking }
 *       403: { description: Not the owner }
 *       404: { description: Booking not found }
 *       409: { description: 'BOOKING_NOT_CANCELLABLE, PAYMENT_IN_PROGRESS or APPOINTMENT_PASSED' }
 */
router.post('/:id/cancel', controller.cancel);

module.exports = router;
