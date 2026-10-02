const { nextStatus } = require('../../src/modules/bookings/bookings.service');

describe('booking state machine', () => {
  test.each([
    ['PENDING', 'PAYMENT_SUCCEEDED', 'CONFIRMED'],
    ['PENDING', 'PAYMENT_FAILED', 'FAILED'],
    ['PENDING', 'CANCEL', 'CANCELLED'],
    ['FAILED', 'PAYMENT_SUCCEEDED', 'CONFIRMED'],
    ['FAILED', 'PAYMENT_FAILED', null],
    ['FAILED', 'CANCEL', 'CANCELLED'],
    ['CONFIRMED', 'PAYMENT_SUCCEEDED', null],
    ['CONFIRMED', 'PAYMENT_FAILED', null],
    ['CONFIRMED', 'CANCEL', 'CANCELLED'],
    ['CANCELLED', 'PAYMENT_SUCCEEDED', null],
    ['CANCELLED', 'PAYMENT_FAILED', null],
    ['CANCELLED', 'CANCEL', null],
    ['UNKNOWN', 'CANCEL', null],
  ])('%s + %s → %s', (from, event, expected) => {
    expect(nextStatus(from, event)).toBe(expected);
  });
});
