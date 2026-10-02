'use strict';

const { prisma } = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const { parsePagination, buildPagination } = require('../../utils/pagination');

// The only place booking status changes are defined. Anything missing is forbidden.
const TRANSITIONS = {
  PENDING: { PAYMENT_SUCCEEDED: 'CONFIRMED', PAYMENT_FAILED: 'FAILED', CANCEL: 'CANCELLED' },
  FAILED: { PAYMENT_SUCCEEDED: 'CONFIRMED', CANCEL: 'CANCELLED' },
  CONFIRMED: { CANCEL: 'CANCELLED' },
  CANCELLED: {},
};

function nextStatus(from, event) {
  return (TRANSITIONS[from] && TRANSITIONS[from][event]) || null;
}

const BOOKING_INCLUDE = { centre: true, test: true };
const BOOKING_DETAIL_INCLUDE = { ...BOOKING_INCLUDE, payments: { orderBy: { createdAt: 'asc' } } };

const bookingNotFound = () => new ApiError(404, 'NOT_FOUND', 'Booking not found');

function assertOwner(booking, userId) {
  if (!booking) throw bookingNotFound();
  if (booking.userId !== userId) throw new ApiError(403, 'FORBIDDEN', 'You do not own this booking');
}

// Row lock that serialises every status change (payments, webhooks, cancel) on one booking.
async function lockBooking(tx, id) {
  const rows = await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.booking.findUnique({ where: { id } });
}

// Caller must hold the booking lock.
async function applyPaymentOutcome(tx, booking, paymentStatus) {
  const event = paymentStatus === 'SUCCESS' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED';
  const status = nextStatus(booking.status, event);
  if (!status) return booking;
  return tx.booking.update({ where: { id: booking.id }, data: { status } });
}

async function createBooking(userId, { centreId, testId, appointmentAt }) {
  const centre = await prisma.centre.findUnique({ where: { id: centreId } });
  if (!centre) throw new ApiError(404, 'CENTRE_NOT_FOUND', 'Centre not found');
  const test = await prisma.diagnosticTest.findUnique({ where: { id: testId } });
  if (!test) throw new ApiError(404, 'TEST_NOT_FOUND', 'Diagnostic test not found');
  if (test.centreId !== centreId) {
    throw new ApiError(422, 'TEST_CENTRE_MISMATCH', 'Test does not belong to the specified centre');
  }
  if (!test.isActive) throw new ApiError(422, 'TEST_INACTIVE', 'Diagnostic test is no longer offered');
  return prisma.booking.create({
    data: { userId, centreId, testId, appointmentAt: new Date(appointmentAt), amount: test.price },
    include: BOOKING_INCLUDE,
  });
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
  const booking = await prisma.booking.findUnique({ where: { id }, include: BOOKING_DETAIL_INCLUDE });
  assertOwner(booking, userId);
  return booking;
}

async function cancelBooking(userId, id) {
  return prisma.$transaction(async (tx) => {
    const booking = await lockBooking(tx, id);
    assertOwner(booking, userId);
    const status = nextStatus(booking.status, 'CANCEL');
    if (!status) throw new ApiError(409, 'BOOKING_NOT_CANCELLABLE', `A ${booking.status} booking cannot be cancelled`);
    const inFlight = await tx.payment.count({ where: { bookingId: id, status: 'PENDING' } });
    if (inFlight) {
      throw new ApiError(409, 'PAYMENT_IN_PROGRESS', 'A payment is in progress; cancel after it settles');
    }
    // Simulated refund: a cancelled booking never keeps a captured payment.
    await tx.payment.updateMany({ where: { bookingId: id, status: 'SUCCESS' }, data: { status: 'REFUNDED' } });
    return tx.booking.update({ where: { id }, data: { status }, include: BOOKING_DETAIL_INCLUDE });
  });
}

module.exports = {
  nextStatus,
  lockBooking,
  applyPaymentOutcome,
  assertOwner,
  createBooking,
  listBookings,
  getBookingById,
  cancelBooking,
};
