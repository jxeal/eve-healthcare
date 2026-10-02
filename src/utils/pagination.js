'use strict';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function parsePagination(query = {}) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

function buildPagination({ page, limit, total }) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return { page, limit, total, totalPages };
}

module.exports = { parsePagination, buildPagination };
