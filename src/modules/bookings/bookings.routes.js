'use strict';

const express = require('express');
const { auth } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const controller = require('./bookings.controller');
const { createBookingSchema } = require('./bookings.schemas');

const router = express.Router();

router.post('/', auth, validate(createBookingSchema), controller.create);
router.get('/', auth, controller.list);
router.get('/:id', auth, controller.getById);
router.post('/:id/cancel', auth, controller.cancel);

module.exports = router;
module.exports.bookingsRoutes = router;
