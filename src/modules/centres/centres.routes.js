'use strict';

const express = require('express');
const { auth } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const controller = require('./centres.controller');
const { centreSchema, diagnosticTestSchema } = require('./centres.schemas');

const router = express.Router();

router.get('/', controller.list);
router.post('/', auth, validate(centreSchema), controller.create);
router.get('/:id', controller.getById);
router.get('/:centreId/tests', controller.listTests);
router.post('/:centreId/tests', auth, validate(diagnosticTestSchema), controller.createTest);

module.exports = router;
module.exports.centresRoutes = router;
