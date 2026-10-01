'use strict';

const { z } = require('zod');

const createPaymentSchema = z.object({
  bookingId: z.string().uuid('bookingId must be a valid UUID'),
  simulate: z.enum(['SUCCESS', 'FAILED']).optional(),
  idempotencyKey: z.string().min(1, 'idempotencyKey must be non-empty').max(128).optional(),
});

const webhookSchema = z
  .object({
    eventId: z.string().min(1, 'eventId is required'),
    paymentId: z.string().uuid('paymentId must be a valid UUID').optional(),
    providerTxnId: z.string().min(1, 'providerTxnId must be non-empty').optional(),
    bookingId: z.string().uuid('bookingId must be a valid UUID').optional(),
    status: z.enum(['SUCCESS', 'FAILED']),
  })
  .refine((v) => v.paymentId || v.providerTxnId || v.bookingId, {
    message: 'At least one of paymentId, providerTxnId, bookingId is required',
    path: ['paymentId'],
  });

module.exports = { createPaymentSchema, webhookSchema };
