'use strict';

const express = require('express');
const { validate } = require('../../middlewares/validate');
const controller = require('./catalog.controller');
const { flatQuerySchema } = require('./catalog.schemas');

const router = express.Router();

/**
 * @openapi
 * /tests:
 *   get:
 *     tags: [Centres]
 *     summary: Flat, paginated list of active tests across centres (cached 60 s)
 *     parameters:
 *       - { name: centreId, in: query, schema: { type: string, format: uuid } }
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 10, maximum: 100 } }
 *     responses:
 *       200: { description: '{ data: DiagnosticTest[], pagination }' }
 *       422: { description: Invalid centreId }
 */
router.get('/', validate(flatQuerySchema, 'query'), controller.list);

module.exports = router;
