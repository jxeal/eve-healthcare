'use strict';

const service = require('./bookings.service');

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const create = ah(async (req, res) => {
  const booking = await service.createBooking(req.user.id, req.body);
  return res.status(201).json(booking);
});

const list = ah(async (req, res) => {
  const result = await service.listBookings(req.user.id, req.query);
  return res.status(200).json(result);
});

const getById = ah(async (req, res) => {
  const booking = await service.getBookingById(req.user.id, req.params.id);
  return res.status(200).json(booking);
});

const cancel = ah(async (req, res) => {
  const booking = await service.cancelBooking(req.user.id, req.params.id);
  return res.status(200).json(booking);
});

module.exports = { create, list, getById, cancel };
