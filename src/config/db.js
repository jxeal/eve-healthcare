'use strict';

// PrismaClient singleton (safe across jest module reloads via global cache).
const { PrismaClient } = require('@prisma/client');

if (!global.__evePrisma) {
  global.__evePrisma = new PrismaClient();
}

const prisma = global.__evePrisma;

module.exports = { prisma };
