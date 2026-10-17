import {
  MAX_ATTEMPTS,
  NotificationDeliveryWorker,
  PUSH_EXPIRY_MS,
  retryBackoffMs,
} from './notification-delivery.worker';
import type { PushService } from './push.service';
import type { PrismaService } from '../prisma/prisma.service';
import * as access from './notification-access';

jest.mock('./notification-access', () => ({
  isRecipientStillAuthorized: jest.fn(),
}));
const authorized = access.isRecipientStillAuthorized as jest.Mock;

const notification = (overrides: Record<string, unknown> = {}) => ({
  id: 'n-1',
  recipientUserId: 'vet-1',
  tenantId: 'clinic-1',
  type: 'RESULTS_RELEASED',
  dedupeKey: 'RESULTS_RELEASED:release:rel-1',
  orderId: 'order-1',
  pickupId: null,
  params: {
    requisitionNumber: 'REQ-1',
    caseId: 'case-1',
    releaseType: 'FINAL',
  },
  readAt: null,
  createdAt: new Date(),
  ...overrides,
});

function makePrisma() {
  return {
    $queryRaw: jest.fn(),
    notification: { findUnique: jest.fn() },
    notificationDelivery: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('NotificationDeliveryWorker', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let push: { sendToUserApp: jest.Mock };
  let worker: NotificationDeliveryWorker;

  /** One claimable delivery, then the queue is empty. */
  function queueOne(attempts = 1) {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'd-1', notificationId: 'n-1', attempts }])
      .mockResolvedValue([]);
  }

  const settledWith = () =>
    prisma.notificationDelivery.updateMany.mock.calls[0][0];

  beforeEach(() => {
    prisma = makePrisma();
    push = { sendToUserApp: jest.fn() };
    worker = new NotificationDeliveryWorker(
      prisma as unknown as PrismaService,
      push as unknown as PushService
    );
    authorized.mockReset().mockResolvedValue(true);
    prisma.notification.findUnique.mockResolvedValue(notification());
  });

  it('creates without error', () => {
    expect(worker).toBeDefined();
  });

  it('sends to the clinic app and marks the delivery SENT', async () => {
    queueOne();
    push.sendToUserApp.mockResolvedValue({ kind: 'SENT' });

    await expect(worker.processBatch()).resolves.toBe(1);

    expect(push.sendToUserApp).toHaveBeenCalledWith(
      'vet-1',
      'CLINIC',
      {
        title: 'Resultados disponibles',
        body: 'REQ-1: los resultados están completos.',
        url: '/cases/case-1/report?clinic=clinic-1',
        tag: 'order:order-1',
      },
      expect.any(Number)
    );
    expect(settledWith()).toEqual({
      where: { id: 'd-1', claimToken: expect.any(String) },
      data: expect.objectContaining({
        status: 'SENT',
        sentAt: expect.any(Date),
        claimToken: null,
      }),
    });
  });

  it('re-checks the recipient and skips the push when no longer authorized', async () => {
    queueOne();
    authorized.mockResolvedValue(false);

    await worker.processBatch();

    expect(push.sendToUserApp).not.toHaveBeenCalled();
    expect(settledWith().data).toEqual(
      expect.objectContaining({
        status: 'SKIPPED',
        lastError: 'Recipient no longer authorized',
      })
    );
  });

  it('expires a push too old to be useful without sending it', async () => {
    queueOne();
    prisma.notification.findUnique.mockResolvedValue(
      notification({ createdAt: new Date(Date.now() - PUSH_EXPIRY_MS - 1) })
    );

    await worker.processBatch();

    expect(authorized).not.toHaveBeenCalled();
    expect(push.sendToUserApp).not.toHaveBeenCalled();
    expect(settledWith().data.status).toBe('EXPIRED');
  });

  it.each([
    ['NO_SUBSCRIPTION', 'No active push subscription'],
    ['NOT_CONFIGURED', 'Web push is not configured'],
  ])('%s → SKIPPED', async (kind, reason) => {
    queueOne();
    push.sendToUserApp.mockResolvedValue({ kind });

    await worker.processBatch();

    expect(settledWith().data).toEqual(
      expect.objectContaining({ status: 'SKIPPED', lastError: reason })
    );
  });

  it('puts a transient failure back with backoff', async () => {
    queueOne(1);
    push.sendToUserApp.mockResolvedValue({ kind: 'FAILED', error: 'timeout' });
    const before = Date.now();

    await worker.processBatch();

    const { data } = settledWith();
    expect(data.status).toBe('PENDING');
    expect(data.lastError).toBe('timeout');
    expect(data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + retryBackoffMs(1)
    );
  });

  it('a thrown send counts as a transient failure', async () => {
    queueOne(1);
    push.sendToUserApp.mockRejectedValue(new Error('db down'));

    await worker.processBatch();

    expect(settledWith().data).toEqual(
      expect.objectContaining({ status: 'PENDING', lastError: 'db down' })
    );
  });

  it('gives up as FAILED once attempts run out', async () => {
    queueOne(MAX_ATTEMPTS);
    push.sendToUserApp.mockResolvedValue({ kind: 'FAILED', error: 'timeout' });

    await worker.processBatch();

    expect(settledWith().data).toEqual(
      expect.objectContaining({ status: 'FAILED', nextAttemptAt: null })
    );
  });

  it('calls the type hook once a delivery settles', async () => {
    const hook = jest.fn().mockResolvedValue(undefined);
    worker.onSettled('RESULTS_RELEASED', hook);
    queueOne();
    push.sendToUserApp.mockResolvedValue({ kind: 'NO_SUBSCRIPTION' });

    await worker.processBatch();

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n-1' }),
      'SKIPPED',
      'No active push subscription'
    );
  });

  it('discards the result (no hook) when another worker reclaimed the row', async () => {
    const hook = jest.fn();
    worker.onSettled('RESULTS_RELEASED', hook);
    queueOne();
    push.sendToUserApp.mockResolvedValue({ kind: 'SENT' });
    prisma.notificationDelivery.updateMany.mockResolvedValue({ count: 0 });

    await worker.processBatch();

    expect(hook).not.toHaveBeenCalled();
  });

  it('a failing hook never breaks the batch', async () => {
    worker.onSettled(
      'RESULTS_RELEASED',
      jest.fn().mockRejectedValue(new Error('x'))
    );
    queueOne();
    push.sendToUserApp.mockResolvedValue({ kind: 'SENT' });

    await expect(worker.processBatch()).resolves.toBe(1);
  });

  it('does nothing when the queue is empty', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(worker.processBatch()).resolves.toBe(0);
    expect(prisma.notification.findUnique).not.toHaveBeenCalled();
  });

  it('backs off 30 s, 2 min, 10 min, then 30 min', () => {
    expect([1, 2, 3, 4, 9].map(retryBackoffMs)).toEqual([
      30_000, 120_000, 600_000, 1_800_000, 1_800_000,
    ]);
  });
});
