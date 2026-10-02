const { parsePagination, buildPagination } = require('../../src/utils/pagination');

describe('pagination helper', () => {
  test('defaults to page=1, limit=10', () => {
    expect(parsePagination({})).toMatchObject({ page: 1, limit: 10, skip: 0, take: 10 });
  });

  test('parses string query params', () => {
    expect(parsePagination({ page: '2', limit: '5' })).toMatchObject({ page: 2, limit: 5, skip: 5 });
  });

  test('clamps limit to max 100 and page minimum 1', () => {
    expect(parsePagination({ page: '1', limit: '9999' }).limit).toBe(100);
    expect(parsePagination({ page: '0', limit: '-5' })).toMatchObject({ page: 1, limit: 10 });
  });

  test('builds pagination envelope', () => {
    expect(buildPagination({ page: 2, limit: 10, total: 95 })).toEqual({ page: 2, limit: 10, total: 95, totalPages: 10 });
    expect(buildPagination({ page: 1, limit: 10, total: 0 }).totalPages).toBe(1);
  });
});
