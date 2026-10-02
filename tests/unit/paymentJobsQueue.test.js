// Loads the queue module as it runs outside tests, with BullMQ replaced by a recorder.
function loadQueue() {
  const fake = { add: jest.fn().mockResolvedValue({}), upsertJobScheduler: jest.fn().mockResolvedValue({}) };
  let queueModule;
  jest.isolateModules(() => {
    jest.doMock('bullmq', () => ({ Queue: jest.fn(() => ({ ...fake, on: jest.fn(), close: jest.fn() })) }));
    jest.doMock('../../src/queue/connection', () => ({ createQueueConnection: jest.fn() }));
    jest.doMock('../../src/config', () => ({ ...jest.requireActual('../../src/config'), env: 'development' }));
    queueModule = require('../../src/queue/paymentJobs');
  });
  return { queueModule, ...fake };
}

describe('payment jobs queue', () => {
  test('every retry is a new job, so a remembered failed job can never swallow it', async () => {
    const { queueModule, add } = loadQueue();
    await queueModule.enqueueWebhookRetry('provider:evt:1');
    await queueModule.enqueueWebhookRetry('provider:evt:1');
    expect(add).toHaveBeenCalledTimes(2);
    for (const [, data, opts] of add.mock.calls) {
      expect(data).toEqual({ eventId: 'provider:evt:1' });
      expect(opts).toBeUndefined();
    }
  });

  test('reports queued:false instead of throwing when Redis rejects the job', async () => {
    const { queueModule, add } = loadQueue();
    add.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(queueModule.enqueueWebhookRetry('evt')).resolves.toEqual({ queued: false });
  });

  test('schedules reconciliation every RECONCILE_INTERVAL_SEC', async () => {
    const { queueModule, upsertJobScheduler } = loadQueue();
    await queueModule.scheduleReconciliation();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'reconcile-payments',
      { every: 60000 },
      expect.objectContaining({ name: 'reconcile-payments' })
    );
  });
});
