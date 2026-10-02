const request = require('supertest');
const { getApp } = require('./app');
const { authHeader } = require('./auth');

const tag = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

async function createCentreWithTest(adminToken, { price = 999, location = 'Pune' } = {}) {
  const app = getApp();
  const centre = await request(app)
    .post('/api/v1/centres')
    .set(authHeader(adminToken))
    .send({ name: tag('Centre'), location });
  if (centre.status !== 201) throw new Error(`centre setup failed: ${JSON.stringify(centre.body)}`);
  const test = await request(app)
    .post(`/api/v1/centres/${centre.body.id}/tests`)
    .set(authHeader(adminToken))
    .send({ name: tag('Test'), price });
  if (test.status !== 201) throw new Error(`test setup failed: ${JSON.stringify(test.body)}`);
  return { centre: centre.body, test: test.body };
}

module.exports = { createCentreWithTest, tag };
