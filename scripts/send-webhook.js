'use strict';

// Sends a signed webhook, standing in for the payment provider.
// Usage: npm run webhook -- <paymentId> <SUCCESS|FAILED> [eventId]
const { randomUUID } = require('crypto');
const config = require('../src/config');
const { signPayload } = require('../src/utils/webhookSignature');

async function main() {
  const [paymentId, status, eventId = `evt_${randomUUID()}`] = process.argv.slice(2);
  if (!paymentId || !['SUCCESS', 'FAILED'].includes(status)) {
    console.error('Usage: npm run webhook -- <paymentId> <SUCCESS|FAILED> [eventId]');
    process.exitCode = 1;
    return;
  }
  const body = JSON.stringify({ eventId, paymentId, status });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const url = process.env.API_URL || `http://localhost:${config.port}/api/v1/payments/webhook`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Signature': signPayload(timestamp, body),
    },
    body,
  });
  console.log(res.status, await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
