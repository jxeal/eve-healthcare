/**
 * Architect-owned (FROZEN) — Agent-2 must make these green.
 * Covers: centres + diagnostic tests CRUD, pagination, search, caching, edge cases.
 */
const request = require('supertest');
const { getApp } = require('../helpers/app');
const { signupUser, authHeader, unique } = require('../helpers/auth');
const { expectErrorShape, expectPaginationShape } = require('../helpers/assert');

let token;
const centreTag = () => `Centre_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

beforeAll(async () => {
  const u = await signupUser();
  token = u.token;
});

async function createCentre(overrides = {}, tok = token) {
  const app = getApp();
  const res = await request(app)
    .post('/api/v1/centres')
    .set(authHeader(tok))
    .send({ name: centreTag(), location: 'Bengaluru', ...overrides });
  return res;
}

async function createTest(centreId, overrides = {}, tok = token) {
  const app = getApp();
  const res = await request(app)
    .post(`/api/v1/centres/${centreId}/tests`)
    .set(authHeader(tok))
    .send({ name: `Test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, price: 499.0, ...overrides });
  return res;
}

describe('Centres — writes', () => {
  test('POST /centres with auth → 201', async () => {
    const res = await createCentre();
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('location');
  });

  test('POST /centres without token → 401', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/centres').send({ name: 'NoAuth', location: 'X' });
    expectErrorShape(res, 401);
  });

  test('POST /centres missing name → 422', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/centres').set(authHeader(token)).send({ location: 'Delhi' });
    expectErrorShape(res, 422);
  });
});

describe('Centres — reads (pagination, search, caching)', () => {
  test('GET /centres returns {data, pagination}', async () => {
    const app = getApp();
    await createCentre();
    const res = await request(app).get('/api/v1/centres');
    expect(res.status).toBe(200);
    expectPaginationShape(res.body);
  });

  test('GET /centres?page=1&limit=2 paginates', async () => {
    const app = getApp();
    const res = await request(app).get('/api/v1/centres?page=1&limit=2');
    expect(res.status).toBe(200);
    expectPaginationShape(res.body);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(2);
  });

  test('GET /centres?search= filters by name/location', async () => {
    const app = getApp();
    const needle = `SearchMe_${Date.now()}`;
    await createCentre({ name: needle, location: 'Hyderabad' });
    const res = await request(app).get(`/api/v1/centres?search=${encodeURIComponent(needle)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(res.body.data)).toMatch(needle);
  });

  test('GET /centres/:id → 200; invalid uuid → 404 (not 500)', async () => {
    const app = getApp();
    const created = await createCentre();
    const ok = await request(app).get(`/api/v1/centres/${created.body.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(created.body.id);

    const bad = await request(app).get('/api/v1/centres/not-a-uuid');
    expect(bad.status).toBe(404);

    const missing = await request(app).get('/api/v1/centres/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
  });

  test('GET caching: repeated reads consistent (Redis outage must not 500)', async () => {
    const app = getApp();
    const created = await createCentre();
    const r1 = await request(app).get(`/api/v1/centres/${created.body.id}`);
    const r2 = await request(app).get(`/api/v1/centres/${created.body.id}`);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(r1.body);
  });
});

describe('Diagnostic tests catalogue', () => {
  test('POST /centres/:id/tests → 201 with price', async () => {
    const centre = await createCentre();
    const res = await createTest(centre.body.id, { name: 'CBC', price: 299.5 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(Number(res.body.price)).toBeCloseTo(299.5);
  });

  test('POST test without auth → 401', async () => {
    const app = getApp();
    const centre = await createCentre();
    const res = await request(app).post(`/api/v1/centres/${centre.body.id}/tests`).send({ name: 'X', price: 100 });
    expectErrorShape(res, 401);
  });

  test('POST test negative price → 422', async () => {
    const centre = await createCentre();
    const res = await createTest(centre.body.id, { price: -50 });
    expectErrorShape(res, 422);
  });

  test('POST test duplicate name in same centre → 409', async () => {
    const centre = await createCentre();
    const name = `DupTest_${Date.now()}`;
    const first = await createTest(centre.body.id, { name, price: 100 });
    expect(first.status).toBe(201);
    const second = await createTest(centre.body.id, { name, price: 100 });
    expectErrorShape(second, 409);
  });

  test('POST test under missing centre → 404', async () => {
    const res = await createTest('00000000-0000-4000-8000-000000000000', { price: 100 });
    expectErrorShape(res, 404);
  });

  test('GET /centres/:id/tests lists tests; GET /tests flat paginates', async () => {
    const app = getApp();
    const centre = await createCentre();
    await createTest(centre.body.id, { price: 150 });
    const nested = await request(app).get(`/api/v1/centres/${centre.body.id}/tests`);
    expect(nested.status).toBe(200);
    expect(Array.isArray(nested.body.data || nested.body)).toBe(true);

    const flat = await request(app).get(`/api/v1/tests?centreId=${centre.body.id}&page=1&limit=10`);
    expect(flat.status).toBe(200);
    expectPaginationShape(flat.body);
  });
});
