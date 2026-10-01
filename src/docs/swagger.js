'use strict';

const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EVE Healthcare API',
      version: '1.0.0',
      description:
        'Diagnostic test bookings with simulated payments and an idempotent provider webhook.',
    },
    servers: [{ url: '/api/v1', description: 'Versioned API' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'NOT_FOUND' },
                message: { type: 'string', example: 'Resource not found' },
                details: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        },
        Payment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            bookingId: { type: 'string', format: 'uuid' },
            amount: { type: 'string', example: '999.00' },
            status: { type: 'string', enum: ['PENDING', 'SUCCESS', 'FAILED'] },
            providerTxnId: { type: 'string', format: 'uuid' },
            idempotencyKey: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  apis: ['./src/modules/**/*.js', './src/docs/*.js'],
};

module.exports = swaggerJSDoc(options);
