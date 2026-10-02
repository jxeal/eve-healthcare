'use strict';

// Demo data: an admin account plus 3 centres with 2-3 tests each. Safe to re-run.
const { PrismaClient } = require('@prisma/client');
const { hash } = require('../src/utils/password');

const prisma = new PrismaClient();

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || 'admin@eve.local').toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';

if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
  throw new Error('Set SEED_ADMIN_PASSWORD; the default admin password is public');
}

const CENTRES = [
  {
    name: 'Apollo Diagnostics',
    location: 'Bengaluru',
    address: '100 Feet Road, Indiranagar',
    phone: '+91-80-1111-2222',
    tests: [
      { name: 'CBC', price: 299.5, description: 'Complete blood count' },
      { name: 'HbA1c', price: 499, description: 'Glycated hemoglobin' },
      { name: 'Lipid Profile', price: 799 },
    ],
  },
  {
    name: 'Metropolis Labs',
    location: 'Pune',
    address: 'FC Road, Shivajinagar',
    phone: '+91-20-3333-4444',
    tests: [
      { name: 'Thyroid Panel (T3/T4/TSH)', price: 649 },
      { name: 'Vitamin D', price: 1299 },
    ],
  },
  {
    name: 'Dr Lal PathLabs',
    location: 'Delhi',
    address: 'Connaught Place',
    phone: '+91-11-5555-6666',
    tests: [
      { name: 'Liver Function Test', price: 899 },
      { name: 'Kidney Function Test', price: 949 },
      { name: 'ECG', price: 399, description: 'Electrocardiogram' },
    ],
  },
];

async function main() {
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: 'ADMIN' },
    create: { name: 'Admin', email: ADMIN_EMAIL, passwordHash: await hash(ADMIN_PASSWORD), role: 'ADMIN' },
  });
  console.log(`admin: ${ADMIN_EMAIL}`);

  for (const { tests, ...data } of CENTRES) {
    const centre =
      (await prisma.centre.findFirst({ where: { name: data.name } })) || (await prisma.centre.create({ data }));
    for (const test of tests) {
      await prisma.diagnosticTest.upsert({
        where: { centreId_name: { centreId: centre.id, name: test.name } },
        update: {},
        create: { ...test, centreId: centre.id },
      });
    }
    console.log(`centre: ${centre.name} (${tests.length} tests)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
