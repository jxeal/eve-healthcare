'use strict';

const { prisma } = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const { parsePagination, buildPagination } = require('../../utils/pagination');

// Booking state machine (AGENT_TASKS.md §0.3).
const TRANSITIONS = {
  'PENDING|SUCCESS': 'CONFIRMED',
  'PENDING|FAILED': 'FAILED',
  'PENDING|CANCEL': 'CANCELLED',
  'CONFIRMED|CANCEL': 'CANCELLED',
};

function canTransition(from, event) {
  return TRANSITIONS[`${from}|${event}`] || null;
}
const transition = canTransition;

const BOOKING_INCLUDE = { centre: true, test: true };

async function createBooking(userId, { centreId, testId, appointmentAt }) {
  const centre = await prisma.centre.findUnique({ where: { id: centreId } });
  if (!centre) throw new ApiError(404, 'CENTRE_NOT_FOUND', 'Centre not found');
  const test = await prisma.diagnosticTest.findUnique({ where: { id: testId } });
  if (!test) throw new ApiError(404, 'TEST_NOT_FOUND', 'Diagnostic test not found');
  if (!test.isActive) throw new ApiError(422, 'VALIDATION_ERROR', 'Diagnostic test is not active');
  if (test.centreId !== centreId) {
    throw new ApiError(422, 'TEST_CENTRE_MISMATCH', 'Test does not belong to the specified centre');
  }
  const booking = await prisma.booking.create({
    data: {
      userId,
      centreId,
      testId,
      appointmentAt: new Date(appointmentAt),
      amount: test.price,
      status: 'PENDING',
    },
    include: BOOKING_INCLUDE,
  });
  return booking;
}

async function listBookings(userId, query = {}) {
  const { page, limit, skip, take } = parsePagination(query);
  const where = { userId };
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: BOOKING_INCLUDE }),
    prisma.booking.count({ where }),
  ]);
  return { data: rows, pagination: buildPagination({ page, limit, total }) };
}

async function getBookingById(userId, id) {
  const booking = await prisma.booking.findUnique({ where: { id }, include: BOOKING_INCLUDE });
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
  if (booking.userId !== userId) throw new ApiError(403, 'FORBIDDEN', 'You do not own this booking');
  return booking;
}

async function cancelBooking(userId, id) {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
  if (booking.userId !== userId) throw new ApiError(403, 'FORBIDDEN', 'You do not own this booking');
  if (booking.status === 'CANCELLED' || booking.status === 'FAILED') {
    throw new ApiError(409, 'BOOKING_NOT_CANCELLABLE', 'Booking cannot be cancelled');
  }
  return prisma.booking.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: BOOKING_INCLUDE,
  });
}

// Drives PENDING bookings from payment/webhook outcomes. Terminal-safe:
// CONFIRMED is never flipped by a late FAILED event; CANCELLED never moves.
// FAILED may still reach CONFIRMED via a successful payment retry (§0.3).
async function applyPaymentResult(bookingId, status) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
  if (status === 'SUCCESS') {
    if (booking.status === 'PENDING' || booking.status === 'FAILED') {
      return prisma.booking.update({ where: { id: bookingId }, data: { status: 'CONFIRMED' } });
    }
    return booking;
  }
  if (status === 'FAILED') {
    if (booking.status === 'PENDING') {
      return prisma.booking.update({ where: { id: bookingId }, data: { status: 'FAILED' } });
    }
    return booking;
  }
  return booking;
}

module.exports = {
  createBooking,
  listBookings,
  getBookingById,
  cancelBooking,
  applyPaymentResult,
  canTransition,
  transition,
};
