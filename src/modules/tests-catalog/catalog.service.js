'use strict';

const { prisma } = require('../../config/db');
const { parsePagination, buildPagination } = require('../../utils/pagination');
const { cached } = require('../../config/redis');

const TTL_SEC = 60;

async function listTestsFlat(query = {}) {
  const { page, limit, skip, take } = parsePagination(query);
  const { centreId } = query;
  return cached(`eve:tests:flat:${centreId || 'all'}:${page}:${limit}`, TTL_SEC, async () => {
    const where = { isActive: true, ...(centreId ? { centreId } : {}) };
    const [rows, total] = await Promise.all([
      prisma.diagnosticTest.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.diagnosticTest.count({ where }),
    ]);
    return { data: rows, pagination: buildPagination({ page, limit, total }) };
  });
}

module.exports = { listTestsFlat };
