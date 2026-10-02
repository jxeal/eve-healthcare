'use strict';

const { prisma } = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const { parsePagination, buildPagination } = require('../../utils/pagination');
const { cacheGet, cacheSet, cacheDel, cacheDelPattern } = require('../../config/redis');

const TTL_SEC = 60;
const keys = {
  centreList: (page, limit, search) => `eve:centres:list:${page}:${limit}:${search}`,
  centre: (id) => `eve:centre:${id}`,
  centreTests: (id) => `eve:centre:${id}:tests`,
  allCentreLists: 'eve:centres:*',
  allFlatTestLists: 'eve:tests:*',
};

const centreNotFound = () => new ApiError(404, 'NOT_FOUND', 'Centre not found');
const duplicateTestName = () =>
  new ApiError(409, 'CONFLICT', 'A test with this name already exists in the centre');

async function cached(key, load) {
  const hit = await cacheGet(key);
  if (hit) return hit;
  const value = await load();
  await cacheSet(key, value, TTL_SEC);
  return value;
}

async function listCentres(query = {}) {
  const { page, limit, skip, take } = parsePagination(query);
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  return cached(keys.centreList(page, limit, search), async () => {
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
    return { data: rows, pagination: buildPagination({ page, limit, total }) };
  });
}

async function getCentreById(id) {
  return cached(keys.centre(id), async () => {
    const centre = await prisma.centre.findUnique({ where: { id } });
    if (!centre) throw centreNotFound();
    return centre;
  });
}

async function createCentre(data) {
  const centre = await prisma.centre.create({ data });
  await cacheDelPattern(keys.allCentreLists);
  return centre;
}

async function updateCentre(id, data) {
  const existing = await prisma.centre.findUnique({ where: { id } });
  if (!existing) throw centreNotFound();
  const centre = await prisma.centre.update({ where: { id }, data });
  await cacheDel(keys.centre(id));
  await cacheDelPattern(keys.allCentreLists);
  return centre;
}

async function listTestsByCentre(centreId) {
  return cached(keys.centreTests(centreId), async () => {
    const centre = await prisma.centre.findUnique({ where: { id: centreId } });
    if (!centre) throw centreNotFound();
    return prisma.diagnosticTest.findMany({
      where: { centreId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  });
}

async function invalidateTests(centreId) {
  await cacheDel(keys.centreTests(centreId));
  await cacheDelPattern(keys.allFlatTestLists);
}

async function createTest(centreId, data) {
  const centre = await prisma.centre.findUnique({ where: { id: centreId } });
  if (!centre) throw centreNotFound();
  try {
    const test = await prisma.diagnosticTest.create({ data: { ...data, centreId } });
    await invalidateTests(centreId);
    return test;
  } catch (err) {
    if (err.code === 'P2002') throw duplicateTestName();
    throw err;
  }
}

async function updateTest(centreId, testId, data) {
  const existing = await prisma.diagnosticTest.findFirst({ where: { id: testId, centreId } });
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Diagnostic test not found in this centre');
  try {
    const test = await prisma.diagnosticTest.update({ where: { id: testId }, data });
    await invalidateTests(centreId);
    return test;
  } catch (err) {
    if (err.code === 'P2002') throw duplicateTestName();
    throw err;
  }
}

module.exports = {
  listCentres,
  getCentreById,
  createCentre,
  updateCentre,
  listTestsByCentre,
  createTest,
  updateTest,
};
