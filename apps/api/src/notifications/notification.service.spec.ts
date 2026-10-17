import { NotFoundException } from '@nestjs/common';
import { NotificationService } from './notification.service';
import type { NotificationDeliveryWorker } from './notification-delivery.worker';
import type { PrismaService } from '../prisma/prisma.service';

function makePrisma() {
  return {
    userTenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
    notification: {
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notificationDelivery: { createMany: jest.fn() },
    pushSubscription: { upsert: jest.fn(), deleteMany: jest.fn() },
  };
}

describe('NotificationService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let worker: { kick: jest.Mock };
  let service: NotificationService;

  beforeEach(() => {
    prisma = makePrisma();
    worker = { kick: jest.fn() };
    service = new NotificationService(
      prisma as unknown as PrismaService,
      worker as unknown as NotificationDeliveryWorker
    );
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('publish', () => {
    const event = {
      type: 'RESULTS_RELEASED' as const,
      tenantId: 'clinic-1',
      eventKey: 'release:rel-1',
      recipientUserIds: ['vet-1', 'vet-1', 'admin-1', 'pending-vet'],
      orderId: 'order-1',
      params: { requisitionNumber: 'REQ-1', releaseType: 'PARTIAL' as const },
    };

    it('notifies each active recipient once and queues one push each', async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([
        { userId: 'vet-1' },
        { userId: 'admin-1' },
      ]);
      prisma.notification.findMany.mockResolvedValue([
        { id: 'n-1' },
        { id: 'n-2' },
      ]);
      const tx = prisma as never;

      await expect(service.publish(tx, event)).resolves.toBe(2);

      // Duplicates collapsed before the membership check
      expect(prisma.userTenantMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'clinic-1',
            userId: { in: ['vet-1', 'admin-1', 'pending-vet'] },
            status: 'ACTIVE',
          }),
        })
      );
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            recipientUserId: 'vet-1',
            tenantId: 'clinic-1',
            type: 'RESULTS_RELEASED',
            dedupeKey: 'RESULTS_RELEASED:release:rel-1',
            orderId: 'order-1',
            pickupId: null,
          }),
          expect.objectContaining({ recipientUserId: 'admin-1' }),
        ],
        skipDuplicates: true,
      });
      expect(prisma.notificationDelivery.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'n-1', channel: 'WEB_PUSH' },
          { notificationId: 'n-2', channel: 'WEB_PUSH' },
        ],
        skipDuplicates: true,
      });
    });

    it('creates nothing when no recipient is an active member', async () => {
      await expect(service.publish(prisma as never, event)).resolves.toBe(0);
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(prisma.notificationDelivery.createMany).not.toHaveBeenCalled();
    });

    it('does not send anything itself — pushes wait for deliverQueued', async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([
        { userId: 'vet-1' },
      ]);
      await service.publish(prisma as never, event);
      expect(worker.kick).not.toHaveBeenCalled();

      service.deliverQueued();
      expect(worker.kick).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    const row = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      type: 'RESULTS_RELEASED',
      tenantId: 'clinic-1',
      orderId: 'order-1',
      pickupId: null,
      params: { requisitionNumber: 'REQ-1', caseId: 'case-1' },
      readAt: null,
      createdAt: new Date('2026-10-18T10:00:00Z'),
      order: { case: { patientName: 'Firulais' } },
      ...extra,
    });

    it('lists only my notifications in the active tenant, newest first', async () => {
      prisma.notification.findMany.mockResolvedValue([row('n-2'), row('n-1')]);

      const result = await service.list('user-1', 'clinic-1');

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { recipientUserId: 'user-1', tenantId: 'clinic-1' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 21,
        })
      );
      expect(result.nextCursor).toBeNull();
      expect(result.items[0]).toEqual({
        id: 'n-2',
        type: 'RESULTS_RELEASED',
        tenantId: 'clinic-1',
        orderId: 'order-1',
        pickupId: undefined,
        params: { requisitionNumber: 'REQ-1', caseId: 'case-1' },
        patientName: 'Firulais',
        link: '/cases/case-1/report?clinic=clinic-1',
        readAt: undefined,
        createdAt: '2026-10-18T10:00:00.000Z',
      });
    });

    it('pages with a cursor and caps the page size', async () => {
      prisma.notification.findMany.mockResolvedValue(
        Array.from({ length: 51 }, (_, i) => row(`n-${i}`))
      );

      const result = await service.list('user-1', 'clinic-1', {
        cursor: 'n-prev',
        limit: 500,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 51,
          cursor: { id: 'n-prev' },
          skip: 1,
        })
      );
      expect(result.items).toHaveLength(50);
      expect(result.nextCursor).toBe('n-49');
    });
  });

  describe('unreadCount', () => {
    it('counts the active clinic and my other active clinics', async () => {
      prisma.userTenantMembership.findMany.mockResolvedValue([
        { tenantId: 'clinic-2' },
      ]);
      prisma.notification.count.mockResolvedValue(3);
      prisma.notification.groupBy.mockResolvedValue([
        { tenantId: 'clinic-2', _count: { _all: 5 } },
      ]);

      await expect(
        service.unreadCount('user-1', 'clinic-1', 'CLINIC')
      ).resolves.toEqual({
        count: 3,
        otherTenants: [{ tenantId: 'clinic-2', count: 5 }],
      });
      expect(prisma.userTenantMembership.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: 'ACTIVE',
          tenantId: { not: 'clinic-1' },
          tenant: { type: { in: ['CLINIC'] } },
        },
        select: { tenantId: true },
      });
      expect(prisma.notification.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            recipientUserId: 'user-1',
            tenantId: { in: ['clinic-2'] },
            readAt: null,
          },
        })
      );
    });

    it('lab inboxes look at lab and platform memberships', async () => {
      await service.unreadCount('user-1', 'lab-1', 'LAB');
      expect(prisma.userTenantMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant: { type: { in: ['LAB', 'PLATFORM'] } },
          }),
        })
      );
      expect(prisma.notification.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('markRead / markAllRead', () => {
    it('marks my unread notification read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.markRead('user-1', 'clinic-1', 'n-1')
      ).resolves.toEqual({ read: true });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'n-1',
          recipientUserId: 'user-1',
          tenantId: 'clinic-1',
          readAt: null,
        },
        data: { readAt: expect.any(Date) },
      });
    });

    it('is a no-op on one already read', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'n-1' });
      await expect(
        service.markRead('user-1', 'clinic-1', 'n-1')
      ).resolves.toEqual({ read: true });
    });

    it("404s on someone else's or another tenant's notification", async () => {
      prisma.notification.findFirst.mockResolvedValue(null);
      await expect(
        service.markRead('user-1', 'clinic-1', 'n-other')
      ).rejects.toThrow(NotFoundException);
      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'n-other',
          recipientUserId: 'user-1',
          tenantId: 'clinic-1',
        },
        select: { id: true },
      });
    });

    it('marks all mine in this tenant read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });
      await expect(service.markAllRead('user-1', 'clinic-1')).resolves.toEqual({
        updated: 4,
      });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          recipientUserId: 'user-1',
          tenantId: 'clinic-1',
          readAt: null,
        },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('push subscriptions', () => {
    const dto = {
      endpoint: 'https://push/1',
      keys: { p256dh: 'k', auth: 'a' },
    };

    it('saves a subscription for the given app, re-pointing a reused endpoint', async () => {
      await service.savePushSubscription('user-1', 'CLINIC', dto);
      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: 'https://push/1' },
        create: {
          userId: 'user-1',
          app: 'CLINIC',
          endpoint: 'https://push/1',
          p256dh: 'k',
          auth: 'a',
        },
        update: { userId: 'user-1', app: 'CLINIC', p256dh: 'k', auth: 'a' },
      });
    });

    it('removes only my own subscription', async () => {
      await service.removePushSubscription('user-1', 'https://push/1');
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', endpoint: 'https://push/1' },
      });
    });
  });
});
