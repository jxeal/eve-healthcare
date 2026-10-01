'use strict';

const { prisma } = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const { parsePagination, buildPagination } = require('../../utils/pagination');
const { cacheGet, cacheSet, cacheDelPattern } = require('../../config/redis');

const TTL_SEC = 60;

async function listCentres(query = {}) {
  const { page, limit, skip, take } = parsePagination(query);
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const cacheKey = `eve:centres:list:${page}:${limit}:${search}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    prisma.centre.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.centre.count({ where }),
  ]);
  const result = { data: rows, pagination: buildPagination({ page, limit, total }) };
  await cacheSet(cacheKey, result, TTL_SEC);
  return result;
}

async function getCentreById(id) {
  const cacheKey = `eve:centre:${id}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  const centre = await prisma.centre.findUnique({ where: { id } });
  if (!centre) throw new ApiError(404, 'NOT_FOUND', 'Centre not found');
  await cacheSet(cacheKey, centre, TTL_SEC);
  return centre;
}

async function createCentre(data) {
  const centre = await prisma.centre.create({ data });
  await cacheDelPattern('eve:centres*');
  return centre;
}

async function listTestsByCentre(centreId) {
  const centre = await prisma.centre.findUnique({ where: { id: centreId } });
  if (!centre) throw new ApiError(404, 'NOT_FOUND', 'Centre not found');
  const cacheKey = `eve:centre:${centreId}:tests`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  const tests = await prisma.diagnosticTest.findMany({
    where: { centreId },
    orderBy: { createdAt: 'asc' },
  });
  await cacheSet(cacheKey, tests, TTL_SEC);
  return tests;
}

async function createTest(centreId, data) {
  const centre = await prisma.centre.findUnique({ where: { id: centreId } });
  if (!centre) throw new ApiError(404, 'NOT_FOUND', 'Centre not found');
  try {
    const test = await prisma.diagnosticTest.create({ data: { ...data, centreId } });
    await cacheDelPattern('eve:centre*');
    await cacheDelPattern('eve:tests*');
    return test;
  } catch (err) {
    if (err && err.code === 'P2002') {
      throw new ApiError(409, 'CONFLICT', 'A test with this name already exists in the centre');
    }
    throw err;
  }
}

module.exports = { listCentres, getCentreById, createCentre, listTestsByCentre, createTest };
