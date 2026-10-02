'use strict';

// Simulated provider; never touches the network. `simulate` forces the outcome,
// otherwise 80% SUCCESS / 20% FAILED.
const { randomUUID } = require('crypto');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function charge({ simulate } = {}) {
  await delay(50 + Math.floor(Math.random() * 101));
  const status = simulate || (Math.random() < 0.8 ? 'SUCCESS' : 'FAILED');
  return { providerTxnId: randomUUID(), status };
}

module.exports = { charge };
