'use strict';

const { z } = require('zod');

const email = z.string().trim().toLowerCase().email('Invalid email address');

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email,
  // bcrypt only uses the first 72 bytes.
  password: z.string().min(6, 'Password must be at least 6 characters').max(72),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

module.exports = { signupSchema, loginSchema };
