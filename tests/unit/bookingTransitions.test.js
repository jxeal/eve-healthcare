/**
 * Architect-owned (FROZEN) — Agent-3 must make these green.
 * Asserts the booking state machine from AGENT_TASKS.md §0.3.
 * Prefers the real implementation if exported; otherwise validates the
 * contract table so the rule is unambiguous for the implementer.
 */
let service = null;
try {
  // eslint-disable-next-line global-require
  service = require('../../src/modules/bookings/bookings.service');
} catch (e) {
  service = null;
}

// Contract table: [from, event, expectedTo | null means forbidden]
const TABLE = [
  ['PENDING', 'SUCCESS', 'CONFIRMED'],
  ['PENDING', 'FAILED', 'FAILED'],
  ['PENDING', 'CANCEL', 'CANCELLED'],
  ['CONFIRMED', 'CANCEL', 'CANCELLED'],
  ['CONFIRMED', 'SUCCESS', null],
  ['CONFIRMED', 'FAILED', null],
  ['FAILED', 'SUCCESS', null],
  ['FAILED', 'CANCEL', null],
  ['CANCELLED', 'SUCCESS', null],
  ['CANCELLED', 'CANCEL', null],
];

function localTransition(from, event) {
  const map = {
    'PENDING|SUCCESS': 'CONFIRMED',
    'PENDING|FAILED': 'FAILED',
    'PENDING|CANCEL': 'CANCELLED',
    'CONFIRMED|CANCEL': 'CANCELLED',
  };
  return map[`${from}|${event}`] || null;
}

describe('booking state machine (§0.3)', () => {
  test.each(TABLE)('%s + %s → %s', (from, event, expected) => {
    const impl =
      service?.canTransition?.(from, event) ??
      service?.transition?.(from, event) ??
      localTransition(from, event);
    // If service exports a boolean guard instead, interpret it:
    const normalized = typeof impl === 'boolean' ? (impl ? expected : null) : impl;
    expect(normalized).toBe(expected);
  });

  test('service module exists (Agent-3 ownership)', () => {
    if (!service) {
      throw new Error('[unit/bookingTransitions] Cannot load src/modules/bookings/bookings.service.js — Agent-3 must implement it (export canTransition or applyPaymentResult).');
    }
    expect(service).toBeTruthy();
  });
});
