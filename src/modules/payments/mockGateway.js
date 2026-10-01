'use strict';

// Deterministic simulated payment gateway. Never touches the network:
//  - when `simulate` is given it wins (after a realistic 50–150ms delay);
//  - otherwise the outcome is random with an 80% SUCCESS bias.
const { randomUUID } = require('crypto');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function charge({ amount, simulate } = {}) {
  void amount;
  const latencyMs = 50 + Math.floor(Math.random() * 101); // 50–150ms
  await delay(latencyMs);

  let status;
  if (simulate === 'SUCCESS' || simulate === 'FAILED') {
    status = simulate;
  } else {
    status = Math.random() < 0.8 ? 'SUCCESS' : 'FAILED';
  }

  return { providerTxnId: randomUUID(), status };
}

module.exports = { charge };
