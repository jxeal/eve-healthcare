const { signPayload, verifySignature } = require('../../src/utils/webhookSignature');

const body = JSON.stringify({ eventId: 'evt_1', paymentId: 'p', status: 'SUCCESS' });
const now = 1_800_000_000;
const valid = { timestamp: String(now), signature: signPayload(String(now), body), rawBody: body, nowSec: now };

describe('webhook signature', () => {
  test('accepts a correctly signed payload', () => {
    expect(verifySignature(valid)).toBeNull();
  });

  test('rejects missing headers', () => {
    expect(verifySignature({ ...valid, signature: undefined })).toMatch(/Missing/);
    expect(verifySignature({ ...valid, timestamp: undefined })).toMatch(/Missing/);
  });

  test('rejects a tampered body', () => {
    expect(verifySignature({ ...valid, rawBody: body.replace('SUCCESS', 'FAILED') })).toMatch(/Invalid/);
  });

  test('rejects a signature made with another secret', () => {
    expect(verifySignature({ ...valid, signature: signPayload(String(now), body, 'other-secret') })).toMatch(/Invalid/);
  });

  test('rejects malformed signatures without throwing', () => {
    expect(verifySignature({ ...valid, signature: 'not-hex' })).toMatch(/Invalid/);
  });

  test('rejects timestamps outside the tolerance window', () => {
    expect(verifySignature({ ...valid, nowSec: now + 301 })).toMatch(/tolerance/);
    expect(verifySignature({ ...valid, nowSec: now + 299 })).toBeNull();
  });
});
