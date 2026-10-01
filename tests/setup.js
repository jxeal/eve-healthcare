/**
 * Architect-owned (FROZEN) — global jest setup.
 * Sets safe test defaults so `npm test` runs without a real .env.
 * Agents: do NOT edit to make tests pass. Fix source code instead.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'eve-test-secret-change-in-prod';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/eve_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

jest.setTimeout(30000);
