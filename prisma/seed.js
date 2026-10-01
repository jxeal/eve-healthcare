'use strict';

// Demo seed: 3 centres × 2–3 diagnostic tests. Idempotent-ish (skips
// existing rows by name). Run: `npm run seed` (see package.json).
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DATA = [
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
  for (const c of DATA) {
    let centre = await prisma.centre.findFirst({ where: { name: c.name } });
    if (!centre) {
      centre = await prisma.centre.create({
        data: { name: c.name, location: c.location, address: c.address, phone: c.phone },
      });
      console.log(`centre: ${centre.name}`);
    }
    for (const t of c.tests) {
      try {
        await prisma.diagnosticTest.create({
          data: { centreId: centre.id, name: t.name, price: t.price, description: t.description },
        });
        console.log(`  test: ${t.name} @ ${centre.name}`);
      } catch (err) {
        if (err && err.code === 'P2002') continue; // already seeded
        throw err;
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
