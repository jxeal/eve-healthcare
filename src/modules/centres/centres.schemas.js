'use strict';

const { z } = require('zod');

const nonEmpty = (schema) =>
  schema.refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

const centreSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters'),
    location: z.string().trim().min(2, 'Location must be at least 2 characters'),
    address: z.string().trim().optional(),
    phone: z.string().trim().optional(),
  })
  .strict();

const diagnosticTestSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required'),
    price: z
      .number()
      .positive('Price must be greater than 0')
      .multipleOf(0.01, 'Price can have at most 2 decimal places')
      .max(99999999.99),
    description: z.string().trim().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

module.exports = {
  centreSchema,
  centreUpdateSchema: nonEmpty(centreSchema.partial()),
  diagnosticTestSchema,
  diagnosticTestUpdateSchema: nonEmpty(diagnosticTestSchema.partial()),
};
