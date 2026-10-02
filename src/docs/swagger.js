'use strict';

const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EVE Healthcare API',
      version: '1.0.0',
      description: 'Diagnostic test bookings with simulated payments and a signed, idempotent provider webhook.',
    },
    servers: [{ url: '/api/v1', description: 'Versioned API' }],
    tags: [{ name: 'Auth' }, { name: 'Centres' }, { name: 'Bookings' }, { name: 'Payments' }],
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
        CentreInput: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 2 },
            location: { type: 'string', minLength: 2 },
            address: { type: 'string' },
            phone: { type: 'string' },
          },
        },
        DiagnosticTestInput: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'number', exclusiveMinimum: 0, multipleOf: 0.01 },
            description: { type: 'string' },
            isActive: { type: 'boolean' },
          },
        },
        Payment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            bookingId: { type: 'string', format: 'uuid' },
            amount: { type: 'string', example: '999.00' },
            status: { type: 'string', enum: ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'] },
            providerTxnId: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  apis: ['./src/modules/**/*.routes.js'],
};

module.exports = swaggerJSDoc(options);
