'use strict';

const { prisma } = require('../../config/db');
const { parsePagination, buildPagination } = require('../../utils/pagination');
const { cacheGet, cacheSet } = require('../../config/redis');

const TTL_SEC = 60;

async function listTestsFlat(query = {}) {
  const { page, limit, skip, take } = parsePagination(query);
  const centreId = typeof query.centreId === 'string' && query.centreId ? query.centreId : undefined;
  const cacheKey = `eve:tests:flat:${centreId || 'all'}:${page}:${limit}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const where = centreId ? { centreId } : {};
  const [rows, total] = await Promise.all([
    prisma.diagnosticTest.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.diagnosticTest.count({ where }),
  ]);
  const result = { data: rows, pagination: buildPagination({ page, limit, total }) };
  await cacheSet(cacheKey, result, TTL_SEC);
  return result;
}

module.exports = { listTestsFlat };
