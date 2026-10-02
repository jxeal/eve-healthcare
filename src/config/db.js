'use strict';

const { PrismaClient } = require('@prisma/client');

// Kept on global so modules re-required through jest.isolateModules share one client.
if (!global.__evePrisma) {
  global.__evePrisma = new PrismaClient();
}

module.exports = { prisma: global.__evePrisma };
