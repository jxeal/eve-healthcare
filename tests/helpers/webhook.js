const request = require('supertest');
const { getApp } = require('./app');
const { signPayload } = require('../../src/utils/webhookSignature');

const eventId = (suffix = '') => `evt_${Date.now()}_${Math.floor(Math.random() * 1e9)}${suffix}`;

function postWebhook(body, { timestamp = Math.floor(Date.now() / 1000), signature } = {}) {
  const raw = JSON.stringify(body);
  return request(getApp())
    .post('/api/v1/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Timestamp', String(timestamp))
    .set('X-Webhook-Signature', signature || signPayload(String(timestamp), raw))
    .send(raw);
}

module.exports = { postWebhook, eventId };
