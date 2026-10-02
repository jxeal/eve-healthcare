const webhookService = require('../../src/modules/payments/webhook.service');
const reconciliation = require('../../src/modules/payments/reconciliation.service');
const { processor } = require('../../src/workers/paymentJobs.worker');
const { JOBS } = require('../../src/queue/paymentJobs');

afterEach(() => jest.restoreAllMocks());

describe('payment jobs worker', () => {
  test('webhook retries rethrow failures so BullMQ backs off and retries', async () => {
    const boom = new Error('db blip');
    jest.spyOn(webhookService, 'processWebhookEvent').mockRejectedValue(boom);
    const record = jest.spyOn(webhookService, 'recordWebhookFailure').mockResolvedValue();
    await expect(processor({ name: JOBS.PROCESS_WEBHOOK_EVENT, data: { eventId: 'evt_x' } })).rejects.toBe(boom);
    expect(record).toHaveBeenCalledWith('evt_x', boom);
  });

  test('webhook retries return the processing result', async () => {
    jest.spyOn(webhookService, 'processWebhookEvent').mockResolvedValue({ ok: true, deduped: true });
    await expect(processor({ name: JOBS.PROCESS_WEBHOOK_EVENT, data: { eventId: 'evt_y' } })).resolves.toEqual({
      ok: true,
      deduped: true,
    });
  });

  test('reconcile jobs run the reconciliation', async () => {
    const run = jest.spyOn(reconciliation, 'runReconciliation').mockResolvedValue({ payments: {}, webhookEvents: {} });
    await processor({ name: JOBS.RECONCILE, data: {} });
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('unknown jobs fail loudly', async () => {
    await expect(processor({ name: 'nope', data: {} })).rejects.toThrow(/Unknown job: nope/);
  });
});
