const webhookService = require('../../src/modules/payments/webhook.service');
const { processor } = require('../../src/workers/webhook.worker');
const { jobIdFor } = require('../../src/queue/webhook.queue');

afterEach(() => jest.restoreAllMocks());

describe('webhook retry worker', () => {
  test('rethrows processing errors so BullMQ retries with backoff', async () => {
    const boom = new Error('db blip');
    jest.spyOn(webhookService, 'processWebhookEvent').mockRejectedValue(boom);
    const record = jest.spyOn(webhookService, 'recordWebhookFailure').mockResolvedValue();
    await expect(processor({ data: { eventId: 'evt_x' } })).rejects.toBe(boom);
    expect(record).toHaveBeenCalledWith('evt_x', boom);
  });

  test('returns the processing result on success', async () => {
    jest.spyOn(webhookService, 'processWebhookEvent').mockResolvedValue({ ok: true, deduped: true });
    await expect(processor({ data: { eventId: 'evt_y' } })).resolves.toEqual({ ok: true, deduped: true });
  });

  test('job ids are stable and never contain ":" (BullMQ rejects them)', () => {
    expect(jobIdFor('stripe:evt:1')).toBe(jobIdFor('stripe:evt:1'));
    expect(jobIdFor('stripe:evt:1')).not.toContain(':');
    expect(jobIdFor('a')).not.toBe(jobIdFor('b'));
  });
});
