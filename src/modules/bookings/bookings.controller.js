'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const service = require('./bookings.service');

const create = asyncHandler(async (req, res) =>
  res.status(201).json(await service.createBooking(req.user.id, req.body)),
);
const list = asyncHandler(async (req, res) => res.status(200).json(await service.listBookings(req.user.id, req.query)));
const getById = asyncHandler(async (req, res) =>
  res.status(200).json(await service.getBookingById(req.user.id, req.params.id)),
);
const cancel = asyncHandler(async (req, res) =>
  res.status(200).json(await service.cancelBooking(req.user.id, req.params.id)),
);

module.exports = { create, list, getById, cancel };
