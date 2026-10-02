// Defaults so `npm test` runs without a .env; point DATABASE_URL_TEST at a migrated test database.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/eve_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.RATE_LIMIT_AUTH_MAX = '10000';
process.env.RATE_LIMIT_PAYMENTS_MAX = '10000';
process.env.RATE_LIMIT_WEBHOOK_MAX = '10000';

// Node 19+ keeps client sockets alive by default, which would hold the test server open at close.
const http = require('http');
http.globalAgent = new http.Agent({ keepAlive: false });

// Each test file gets its own server, PrismaClient and Redis client; close them so jest can exit.
afterAll(async () => {
  if (global.__testServer) await new Promise((resolve) => global.__testServer.close(resolve));
  require('../src/config/redis').closeCache();
  await require('../src/config/db').prisma.$disconnect();
});
