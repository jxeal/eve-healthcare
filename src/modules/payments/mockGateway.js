'use strict';

const { randomUUID } = require('crypto');

const LEDGER_LIMIT = 10000;
// Stands in for the provider's own records, keyed by our payment id; lost on restart.
const ledger = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function record(reference, charge) {
  ledger.set(reference, charge);
  if (ledger.size > LEDGER_LIMIT) ledger.delete(ledger.keys().next().value);
  return { ...charge };
}

async function charge({ reference, simulate }) {
  await delay(50 + Math.floor(Math.random() * 101));
  const status = simulate || (Math.random() < 0.8 ? 'SUCCESS' : 'FAILED');
  return record(reference, { providerTxnId: randomUUID(), status });
}

async function retrieve(reference) {
  const existing = ledger.get(reference);
  return existing ? { ...existing } : null;
}

async function cancel(reference) {
  const existing = ledger.get(reference);
  if (existing && existing.status === 'PENDING') record(reference, { ...existing, status: 'FAILED' });
}

module.exports = { charge, retrieve, cancel };
