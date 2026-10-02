'use strict';

const PUBLIC_FIELDS = ['id', 'bookingId', 'amount', 'status', 'providerTxnId', 'createdAt', 'updatedAt'];

const publicPaymentSelect = Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, true]));

function toPublicPayment(payment) {
  return Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, payment[field]]));
}

module.exports = { publicPaymentSelect, toPublicPayment };
