'use strict';

const { z } = require('zod');

const idempotencyKey = z.string().trim().min(1, 'Idempotency key must be non-empty').max(128);

const createPaymentSchema = z.object({
  bookingId: z.string().uuid('bookingId must be a valid UUID'),
  // PENDING leaves the outcome to a later webhook, like an async provider would.
  simulate: z.enum(['SUCCESS', 'FAILED', 'PENDING']).optional(),
  idempotencyKey: idempotencyKey.optional(),
});

const webhookSchema = z
  .object({
    eventId: z.string().min(1, 'eventId is required').max(255),
    paymentId: z.string().uuid('paymentId must be a valid UUID').optional(),
    providerTxnId: z.string().min(1, 'providerTxnId must be non-empty').optional(),
    status: z.enum(['SUCCESS', 'FAILED']),
  })
  .refine((v) => v.paymentId || v.providerTxnId, {
    message: 'paymentId or providerTxnId is required',
    path: ['paymentId'],
  });

module.exports = { createPaymentSchema, webhookSchema, idempotencyKey };
