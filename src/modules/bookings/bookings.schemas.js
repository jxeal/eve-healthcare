'use strict';

const { z } = require('zod');

const createBookingSchema = z
  .object({
    centreId: z.string().uuid('centreId must be a valid UUID'),
    testId: z.string().uuid('testId must be a valid UUID'),
    appointmentAt: z
      .string()
      .datetime({ offset: true, message: 'appointmentAt must be an ISO datetime' })
      .refine((v) => new Date(v).getTime() > Date.now(), {
        message: 'appointmentAt must be in the future',
      }),
  })
  .strict();

module.exports = { createBookingSchema };
