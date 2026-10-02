'use strict';

const { PrismaClient } = require('@prisma/client');

// Cached on global so jest's per-file module registry reuses one client.
if (!global.__evePrisma) {
  global.__evePrisma = new PrismaClient();
}

module.exports = { prisma: global.__evePrisma };
