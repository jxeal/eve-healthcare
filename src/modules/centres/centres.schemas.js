'use strict';

const { z } = require('zod');

const centreSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  location: z.string().min(2, 'Location must be at least 2 characters'),
  address: z.string().optional(),
  phone: z.string().optional(),
});

const diagnosticTestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  price: z.coerce.number().positive('Price must be greater than 0'),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

module.exports = { centreSchema, diagnosticTestSchema };
