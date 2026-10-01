/**
 * Architect-owned (FROZEN) — shared assertions for error/pagination envelopes.
 */

function expectErrorShape(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.body).toHaveProperty('error');
  expect(res.body.error).toHaveProperty('code');
  expect(res.body.error).toHaveProperty('message');
  if (code) expect(res.body.error.code).toBe(code);
}

function expectPaginationShape(body) {
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('pagination');
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.pagination).toMatchObject({
    page: expect.any(Number),
    limit: expect.any(Number),
    total: expect.any(Number),
    totalPages: expect.any(Number),
  });
}

/** A date string safely in the future (default +7 days). */
function futureISO(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** A date string safely in the past (default -1 day). */
function pastISO(days = 1) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const randomId = () => `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;

module.exports = { expectErrorShape, expectPaginationShape, futureISO, pastISO, randomId };
