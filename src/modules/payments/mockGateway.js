'use strict';

const { randomUUID } = require('crypto');
const { prisma } = require('../../config/db');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const view = (charge) => charge && { providerTxnId: charge.providerTxnId, status: charge.status };

async function charge({ reference, amount, simulate }) {
  await delay(50 + Math.floor(Math.random() * 101));
  const status = simulate || (Math.random() < 0.8 ? 'SUCCESS' : 'FAILED');
  return view(
    await prisma.simulatedCharge.create({ data: { reference, amount, status, providerTxnId: randomUUID() } }),
  );
}

async function retrieve(reference) {
  return view(await prisma.simulatedCharge.findUnique({ where: { reference } }));
}

// Returns the charge as it stands afterwards, which may already have settled.
async function cancel(reference) {
  await prisma.simulatedCharge.updateMany({ where: { reference, status: 'PENDING' }, data: { status: 'FAILED' } });
  return retrieve(reference);
}

module.exports = { charge, retrieve, cancel };
