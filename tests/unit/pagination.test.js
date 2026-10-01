/**
 * Architect-owned (FROZEN) — Agent-1 must make these green.
 * Tests src/utils/pagination.js contract (exact path mandated by AGENT_TASKS.md).
 */
let pagination;
try {
  // eslint-disable-next-line global-require
  pagination = require('../../src/utils/pagination');
} catch (e) {
  throw new Error(`[unit/pagination] Cannot load src/utils/pagination.js — Agent-1 must implement it. Original: ${e.message}`);
}

const parse = pagination.parsePagination || pagination.default?.parsePagination || pagination;

describe('pagination helper', () => {
  test('defaults to page=1, limit=10', () => {
    expect(parse({})).toMatchObject({ page: 1, limit: 10 });
  });

  test('parses string query params', () => {
    expect(parse({ page: '2', limit: '5' })).toMatchObject({ page: 2, limit: 5 });
  });

  test('clamps limit to max 100 and page minimum 1', () => {
    const hi = parse({ page: '1', limit: '9999' });
    expect(hi.limit).toBeLessThanOrEqual(100);
    const lo = parse({ page: '0', limit: '-5' });
    expect(lo.page).toBeGreaterThanOrEqual(1);
  });

  test('builds pagination envelope when helper provided', () => {
    const build = pagination.buildPagination || pagination.default?.buildPagination;
    if (!build) return; // optional helper
    expect(build({ page: 2, limit: 10, total: 95 })).toMatchObject({ page: 2, limit: 10, total: 95, totalPages: 10 });
  });
});
