'use strict';

// Usage: npm run webhook -- <paymentId> <SUCCESS|FAILED> [eventId]
const { randomUUID } = require('crypto');
const config = require('../src/config');
const { prisma } = require('../src/config/db');
const { signPayload } = require('../src/utils/webhookSignature');

async function main() {
  const [paymentId, status, eventId = `evt_${randomUUID()}`] = process.argv.slice(2);
  if (!paymentId || !['SUCCESS', 'FAILED'].includes(status)) {
    console.error('Usage: npm run webhook -- <paymentId> <SUCCESS|FAILED> [eventId]');
    process.exitCode = 1;
    return;
  }
  // Like a real provider, settle the charge in its own records before notifying the API.
  await prisma.simulatedCharge.updateMany({ where: { reference: paymentId, status: 'PENDING' }, data: { status } });
  await prisma.$disconnect();
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
