'use strict';

const { z } = require('zod');

const flatQuerySchema = z.object({
  centreId: z.string().uuid().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

module.exports = { flatQuerySchema };
