const request = require('supertest');
const { getApp } = require('../helpers/app');
const { signupUser, createAdmin, authHeader } = require('../helpers/auth');
const { expectErrorShape, expectPaginationShape } = require('../helpers/assert');
const { tag } = require('../helpers/catalog');
const { prisma } = require('../../src/config/db');

let adminToken;
let userToken;

beforeAll(async () => {
  adminToken = (await createAdmin()).token;
  userToken = (await signupUser()).token;
});

function createCentre(overrides = {}, tok = adminToken) {
  return request(getApp())
    .post('/api/v1/centres')
    .set(authHeader(tok))
    .send({ name: tag('Centre'), location: 'Bengaluru', ...overrides });
}

function createTest(centreId, overrides = {}, tok = adminToken) {
  return request(getApp())
    .post(`/api/v1/centres/${centreId}/tests`)
    .set(authHeader(tok))
    .send({ name: tag('Test'), price: 499.0, ...overrides });
}

describe('Centres — writes', () => {
  test('admin POST /centres → 201', async () => {
    const res = await createCentre();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: expect.any(String), name: expect.any(String), location: 'Bengaluru' });
  });

  test('POST /centres without token → 401', async () => {
    const res = await request(getApp()).post('/api/v1/centres').send({ name: 'NoAuth', location: 'X' });
    expectErrorShape(res, 401);
  });

  test('POST /centres as a regular user → 403', async () => {
    const res = await createCentre({}, userToken);
    expectErrorShape(res, 403, 'FORBIDDEN');
  });

  test('roles are read from the database, so changes apply without logging in again', async () => {
    const user = await signupUser();
    await prisma.user.update({ where: { id: user.user.id }, data: { role: 'ADMIN' } });
    expect((await createCentre({}, user.token)).status).toBe(201);
    await prisma.user.update({ where: { id: user.user.id }, data: { role: 'USER' } });
    expectErrorShape(await createCentre({}, user.token), 403, 'FORBIDDEN');
  });

  test('POST /centres missing name → 422', async () => {
    const res = await request(getApp()).post('/api/v1/centres').set(authHeader(adminToken)).send({ location: 'Delhi' });
    expectErrorShape(res, 422, 'VALIDATION_ERROR');
  });

  test('PATCH /centres/:id updates and invalidates the cached detail', async () => {
    const app = getApp();
    const created = await createCentre();
    await request(app).get(`/api/v1/centres/${created.body.id}`);
    const res = await request(app)
      .patch(`/api/v1/centres/${created.body.id}`)
      .set(authHeader(adminToken))
      .send({ location: 'Mysuru' });
    expect(res.status).toBe(200);
    expect(res.body.location).toBe('Mysuru');
    const after = await request(app).get(`/api/v1/centres/${created.body.id}`);
    expect(after.body.location).toBe('Mysuru');
  });

  test('PATCH /centres/:id: user → 403, missing → 404, empty body → 422', async () => {
    const app = getApp();
    const created = await createCentre();
    const asUser = await request(app).patch(`/api/v1/centres/${created.body.id}`).set(authHeader(userToken)).send({ location: 'X1' });
    expectErrorShape(asUser, 403);
    const missing = await request(app)
      .patch('/api/v1/centres/00000000-0000-4000-8000-000000000000')
      .set(authHeader(adminToken))
      .send({ location: 'X1' });
    expectErrorShape(missing, 404);
    const empty = await request(app).patch(`/api/v1/centres/${created.body.id}`).set(authHeader(adminToken)).send({});
    expectErrorShape(empty, 422);
  });
});

describe('Centres — reads (pagination, search, caching)', () => {
  test('GET /centres returns {data, pagination}', async () => {
    await createCentre();
    const res = await request(getApp()).get('/api/v1/centres');
    expect(res.status).toBe(200);
    expectPaginationShape(res.body);
  });

  test('GET /centres?page=1&limit=2 paginates', async () => {
    const res = await request(getApp()).get('/api/v1/centres?page=1&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2 });
  });

  test('GET /centres?search= filters by name/location', async () => {
    const needle = tag('SearchMe');
    await createCentre({ name: needle, location: 'Hyderabad' });
    const res = await request(getApp()).get(`/api/v1/centres?search=${encodeURIComponent(needle)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.name)).toEqual([needle]);
  });

  test('GET /centres/:id → 200; invalid uuid → 404 (not 500)', async () => {
    const app = getApp();
    const created = await createCentre();
    const ok = await request(app).get(`/api/v1/centres/${created.body.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(created.body.id);
    expect((await request(app).get('/api/v1/centres/not-a-uuid')).status).toBe(404);
    expect((await request(app).get('/api/v1/centres/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  test('repeated reads are consistent (cache hit or DB fallback)', async () => {
    const app = getApp();
    const created = await createCentre();
    const r1 = await request(app).get(`/api/v1/centres/${created.body.id}`);
    const r2 = await request(app).get(`/api/v1/centres/${created.body.id}`);
    expect(r1.status).toBe(200);
    expect(r2.body).toEqual(r1.body);
  });
});

describe('Diagnostic tests catalogue', () => {
  test('POST /centres/:id/tests → 201 with price', async () => {
    const centre = await createCentre();
    const res = await createTest(centre.body.id, { name: 'CBC', price: 299.5 });
    expect(res.status).toBe(201);
    expect(Number(res.body.price)).toBeCloseTo(299.5);
  });

  test('POST test without auth → 401; as user → 403', async () => {
    const centre = await createCentre();
    const anon = await request(getApp()).post(`/api/v1/centres/${centre.body.id}/tests`).send({ name: 'X', price: 100 });
    expectErrorShape(anon, 401);
    expectErrorShape(await createTest(centre.body.id, {}, userToken), 403);
  });

  test('POST test negative price → 422', async () => {
    const centre = await createCentre();
    expectErrorShape(await createTest(centre.body.id, { price: -50 }), 422);
  });

  test.each([0, 0.001, 299.999, true, [42], '499'])('POST test with price %p → 422', async (price) => {
    const centre = await createCentre();
    expectErrorShape(await createTest(centre.body.id, { price }), 422, 'VALIDATION_ERROR');
  });

  test('the database rejects a non-positive price even without the API', async () => {
    const centre = await createCentre();
    await expect(
      prisma.diagnosticTest.create({ data: { centreId: centre.body.id, name: tag('Free'), price: 0 } })
    ).rejects.toThrow(/DiagnosticTest_price_positive/);
  });

  test('POST test duplicate name in same centre → 409', async () => {
    const centre = await createCentre();
    const name = tag('DupTest');
    expect((await createTest(centre.body.id, { name })).status).toBe(201);
    expectErrorShape(await createTest(centre.body.id, { name }), 409);
  });

  test('POST test under missing centre → 404', async () => {
    expectErrorShape(await createTest('00000000-0000-4000-8000-000000000000'), 404);
  });

  test('GET /centres/:id/tests lists tests; GET /tests flat paginates; bad centreId → 422', async () => {
    const app = getApp();
    const centre = await createCentre();
    await createTest(centre.body.id, { price: 150 });
    const nested = await request(app).get(`/api/v1/centres/${centre.body.id}/tests`);
    expect(nested.status).toBe(200);
    expect(nested.body).toHaveLength(1);
    const flat = await request(app).get(`/api/v1/tests?centreId=${centre.body.id}&page=1&limit=10`);
    expect(flat.status).toBe(200);
    expectPaginationShape(flat.body);
    expect(flat.body.data).toHaveLength(1);
    expectErrorShape(await request(app).get('/api/v1/tests?centreId=nope'), 422);
  });

  test('PATCH test price and retire it: hidden from public lists', async () => {
    const app = getApp();
    const centre = await createCentre();
    const test = (await createTest(centre.body.id, { price: 200 })).body;
    await request(app).get(`/api/v1/centres/${centre.body.id}/tests`);

    const repriced = await request(app)
      .patch(`/api/v1/centres/${centre.body.id}/tests/${test.id}`)
      .set(authHeader(adminToken))
      .send({ price: 250 });
    expect(repriced.status).toBe(200);
    expect(Number(repriced.body.price)).toBe(250);

    const retired = await request(app)
      .patch(`/api/v1/centres/${centre.body.id}/tests/${test.id}`)
      .set(authHeader(adminToken))
      .send({ isActive: false });
    expect(retired.body.isActive).toBe(false);
    const nested = await request(app).get(`/api/v1/centres/${centre.body.id}/tests`);
    expect(nested.body).toHaveLength(0);
    const flat = await request(app).get(`/api/v1/tests?centreId=${centre.body.id}`);
    expect(flat.body.data).toHaveLength(0);
  });

  test('PATCH test: wrong centre → 404, duplicate name → 409', async () => {
    const app = getApp();
    const centre = await createCentre();
    const other = await createCentre();
    const a = (await createTest(centre.body.id)).body;
    const b = (await createTest(centre.body.id)).body;
    const wrongCentre = await request(app)
      .patch(`/api/v1/centres/${other.body.id}/tests/${a.id}`)
      .set(authHeader(adminToken))
      .send({ price: 10 });
    expectErrorShape(wrongCentre, 404);
    const dup = await request(app)
      .patch(`/api/v1/centres/${centre.body.id}/tests/${b.id}`)
      .set(authHeader(adminToken))
      .send({ name: a.name });
    expectErrorShape(dup, 409);
  });
});

describe('Error envelope', () => {
  test('malformed JSON → 400 INVALID_JSON', async () => {
    const res = await request(getApp()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{bad');
    expectErrorShape(res, 400, 'INVALID_JSON');
  });

  test('unknown route → 404', async () => {
    expectErrorShape(await request(getApp()).get('/api/v1/nope'), 404, 'NOT_FOUND');
  });
});
