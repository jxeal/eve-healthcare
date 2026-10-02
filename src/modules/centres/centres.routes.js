'use strict';

const express = require('express');
const { auth, requireRole } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const controller = require('./centres.controller');
const {
  centreSchema,
  centreUpdateSchema,
  diagnosticTestSchema,
  diagnosticTestUpdateSchema,
} = require('./centres.schemas');

const router = express.Router();
const admin = [auth, requireRole('ADMIN')];

/**
 * @openapi
 * /centres:
 *   get:
 *     tags: [Centres]
 *     summary: List centres (cached 60 s)
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 10, maximum: 100 } }
 *       - { name: search, in: query, description: Matches name or location, schema: { type: string } }
 *     responses:
 *       200: { description: '{ data: Centre[], pagination }' }
 *   post:
 *     tags: [Centres]
 *     summary: Create a centre (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CentreInput' }
 *     responses:
 *       201: { description: Centre }
 *       401: { description: Missing token }
 *       403: { description: Not an admin }
 *       422: { description: Validation error }
 */
router.get('/', controller.list);
router.post('/', ...admin, validate(centreSchema), controller.create);

/**
 * @openapi
 * /centres/{id}:
 *   get:
 *     tags: [Centres]
 *     summary: Get a centre
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Centre }
 *       404: { description: Centre not found }
 *   patch:
 *     tags: [Centres]
 *     summary: Update a centre (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CentreInput' }
 *     responses:
 *       200: { description: Centre }
 *       403: { description: Not an admin }
 *       404: { description: Centre not found }
 */
router.get('/:id', controller.getById);
router.patch('/:id', ...admin, validate(centreUpdateSchema), controller.update);

/**
 * @openapi
 * /centres/{centreId}/tests:
 *   get:
 *     tags: [Centres]
 *     summary: Active tests offered by a centre
 *     parameters:
 *       - { name: centreId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: 'DiagnosticTest[]' }
 *       404: { description: Centre not found }
 *   post:
 *     tags: [Centres]
 *     summary: Add a test to a centre (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: centreId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/DiagnosticTestInput' }
 *     responses:
 *       201: { description: DiagnosticTest }
 *       403: { description: Not an admin }
 *       404: { description: Centre not found }
 *       409: { description: Duplicate test name in this centre }
 */
router.get('/:centreId/tests', controller.listTests);
router.post('/:centreId/tests', ...admin, validate(diagnosticTestSchema), controller.createTest);

/**
 * @openapi
 * /centres/{centreId}/tests/{testId}:
 *   patch:
 *     tags: [Centres]
 *     summary: Update a test, e.g. its price, or retire it with isActive=false (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: centreId, in: path, required: true, schema: { type: string, format: uuid } }
 *       - { name: testId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/DiagnosticTestInput' }
 *     responses:
 *       200: { description: DiagnosticTest }
 *       403: { description: Not an admin }
 *       404: { description: Test not found in this centre }
 *       409: { description: Duplicate test name in this centre }
 */
router.patch('/:centreId/tests/:testId', ...admin, validate(diagnosticTestUpdateSchema), controller.updateTest);

module.exports = router;
