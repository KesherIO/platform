import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PickupService } from './pickup.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../notifications/push.service';

const LAB_ID = 'lab-1';
const CLINIC_ID = 'clinic-1';
const ORDER_ID = 'order-1';
const PICKUP_ID = 'pickup-1';
const MESSENGER_ID = 'messenger-1';
const OTHER_USER_ID = 'other-user-1';
const ADMIN_ID = 'admin-1';

function makePickup(overrides: Record<string, unknown> = {}) {
  return {
    id: PICKUP_ID,
    orderId: ORDER_ID,
    labTenantId: LAB_ID,
    clinicTenantId: CLINIC_ID,
    status: 'REQUESTED',
    priority: 'ROUTINE',
    pickupAddress: '123 Main St',
    pickupContactName: 'Jane Vet',
    pickupContactPhone: '555-1234',
    pickupInstructions: null,
    requestedPickupTime: null,
    messengerId: null,
    assignedAt: null,
    notifiedAt: null,
    notifyFailReason: null,
    acceptedAt: null,
    collectedAt: null,
    receivedAt: null,
    cancelledAt: null,
    failedAt: null,
    failReason: null,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    order: { requisitionNumber: 'REQ-2026-000001' },
    clinicTenant: { name: 'Demo Clinic' },
    messenger: null,
    ...overrides,
  };
}

describe('PickupService', () => {
  let service: PickupService;
  let prisma: Record<string, any>;
  let pushService: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      pickup: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      order: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userTenantMembership: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      timelineEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      pushSubscription: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    pushService = { sendToUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PickupService,
        { provide: PrismaService, useValue: prisma },
        { provide: PushService, useValue: pushService },
      ],
    }).compile();

    service = module.get<PickupService>(PickupService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('createPickup', () => {
    it('creates a REQUESTED pickup and a PICKUP_REQUESTED timeline event', async () => {
      const created = makePickup();
      prisma.pickup.create.mockResolvedValue(created);

      const result = await service.createPickup(
        ORDER_ID,
        LAB_ID,
        CLINIC_ID,
        {
          pickupAddress: '123 Main St',
          pickupContactName: 'Jane Vet',
          pickupContactPhone: '555-1234',
          pickupInstructions: null,
        },
        'ROUTINE'
      );

      expect(prisma.pickup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: ORDER_ID,
            labTenantId: LAB_ID,
            clinicTenantId: CLINIC_ID,
            priority: 'ROUTINE',
          }),
        })
      );
      expect(prisma.timelineEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: ORDER_ID,
            pickupId: PICKUP_ID,
            eventType: 'PICKUP_REQUESTED',
          }),
        })
      );
      expect(result).toEqual(created);
    });
  });

  describe('assignMessenger', () => {
    it('assigns, transitions to NOTIFIED, and records a successful push', async () => {
      prisma.pickup.findFirst.mockResolvedValue(makePickup());
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        role: 'MESSENGER',
        user: { firstName: 'Sam', lastName: 'Courier' },
      });
      prisma.order.findUnique.mockResolvedValue({
        requisitionNumber: 'REQ-2026-000001',
      });
      pushService.sendToUser.mockResolvedValue(true);
      prisma.pickup.update.mockResolvedValue(
        makePickup({ status: 'NOTIFIED' })
      );

      await service.assignMessenger(LAB_ID, PICKUP_ID, MESSENGER_ID, ADMIN_ID);

      expect(prisma.pickup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            messengerId: MESSENGER_ID,
            status: 'ASSIGNED',
          }),
        })
      );
      expect(prisma.pickup.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'NOTIFIED' } })
      );
      expect(pushService.sendToUser).toHaveBeenCalledWith(
        MESSENGER_ID,
        expect.objectContaining({ url: '/my-pickups' })
      );
      const timelineEventTypes = (
        prisma.timelineEvent.create as jest.Mock
      ).mock.calls.map((call) => call[0].data.eventType);
      expect(timelineEventTypes).toEqual([
        'PICKUP_ASSIGNED',
        'NOTIFICATION_SENT',
      ]);
    });

    it('records NOTIFICATION_FAILED when the push send fails', async () => {
      prisma.pickup.findFirst.mockResolvedValue(makePickup());
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        role: 'MESSENGER',
        user: { firstName: 'Sam', lastName: 'Courier' },
      });
      prisma.order.findUnique.mockResolvedValue({
        requisitionNumber: 'REQ-2026-000001',
      });
      pushService.sendToUser.mockResolvedValue(false);
      prisma.pickup.update.mockResolvedValue(
        makePickup({ status: 'NOTIFIED' })
      );

      await service.assignMessenger(LAB_ID, PICKUP_ID, MESSENGER_ID, ADMIN_ID);

      const timelineEventTypes = (
        prisma.timelineEvent.create as jest.Mock
      ).mock.calls.map((call) => call[0].data.eventType);
      expect(timelineEventTypes).toEqual([
        'PICKUP_ASSIGNED',
        'NOTIFICATION_FAILED',
      ]);
    });

    it('rejects assignment when the pickup is not REQUESTED (optimistic concurrency)', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'ASSIGNED' })
      );

      await expect(
        service.assignMessenger(LAB_ID, PICKUP_ID, MESSENGER_ID, ADMIN_ID)
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects assignment when the target user is not a MESSENGER', async () => {
      prisma.pickup.findFirst.mockResolvedValue(makePickup());
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        role: 'TECHNICIAN',
        user: { firstName: 'Sam', lastName: 'Courier' },
      });

      await expect(
        service.assignMessenger(LAB_ID, PICKUP_ID, MESSENGER_ID, ADMIN_ID)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the pickup does not belong to this lab', async () => {
      prisma.pickup.findFirst.mockResolvedValue(null);

      await expect(
        service.assignMessenger(LAB_ID, PICKUP_ID, MESSENGER_ID, ADMIN_ID)
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('acceptPickup', () => {
    it('rejects when the pickup is not assigned to this user', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'NOTIFIED', messengerId: MESSENGER_ID })
      );

      await expect(
        service.acceptPickup(LAB_ID, PICKUP_ID, OTHER_USER_ID)
      ).rejects.toThrow(ForbiddenException);
    });

    it('is idempotent when already ACCEPTED', async () => {
      const pickup = makePickup({
        status: 'ACCEPTED',
        messengerId: MESSENGER_ID,
      });
      prisma.pickup.findFirst.mockResolvedValue(pickup);

      const result = await service.acceptPickup(
        LAB_ID,
        PICKUP_ID,
        MESSENGER_ID
      );

      expect(result.status).toBe('ACCEPTED');
      expect(prisma.pickup.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid transition (not NOTIFIED)', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'REQUESTED', messengerId: MESSENGER_ID })
      );

      await expect(
        service.acceptPickup(LAB_ID, PICKUP_ID, MESSENGER_ID)
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a NOTIFIED pickup assigned to this messenger', async () => {
      prisma.pickup.findFirst
        .mockResolvedValueOnce(
          makePickup({ status: 'NOTIFIED', messengerId: MESSENGER_ID })
        )
        .mockResolvedValueOnce(
          makePickup({ status: 'ACCEPTED', messengerId: MESSENGER_ID })
        );
      prisma.pickup.update.mockResolvedValue(
        makePickup({ status: 'ACCEPTED', messengerId: MESSENGER_ID })
      );

      const result = await service.acceptPickup(
        LAB_ID,
        PICKUP_ID,
        MESSENGER_ID
      );

      expect(result.status).toBe('ACCEPTED');
      expect(prisma.timelineEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'PICKUP_ACCEPTED' }),
        })
      );
    });
  });

  describe('markCollected', () => {
    it('is idempotent when already IN_TRANSIT', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'IN_TRANSIT', messengerId: MESSENGER_ID })
      );

      const result = await service.markCollected(
        LAB_ID,
        PICKUP_ID,
        MESSENGER_ID
      );

      expect(result.status).toBe('IN_TRANSIT');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('transitions ACCEPTED -> IN_TRANSIT and updates Order.collectedAt', async () => {
      prisma.pickup.findFirst
        .mockResolvedValueOnce(
          makePickup({ status: 'ACCEPTED', messengerId: MESSENGER_ID })
        )
        .mockResolvedValueOnce(
          makePickup({ status: 'IN_TRANSIT', messengerId: MESSENGER_ID })
        );

      const result = await service.markCollected(
        LAB_ID,
        PICKUP_ID,
        MESSENGER_ID
      );

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: expect.objectContaining({ collectedAt: expect.any(Date) }),
        })
      );
      const timelineEventTypes = (
        prisma.timelineEvent.create as jest.Mock
      ).mock.calls.map((call) => call[0].data.eventType);
      expect(timelineEventTypes).toEqual(['SAMPLE_COLLECTED', 'IN_TRANSIT']);
      expect(result.status).toBe('IN_TRANSIT');
    });
  });

  describe('reportProblem', () => {
    it('rejects when the pickup is not assigned to this user', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'ACCEPTED', messengerId: MESSENGER_ID })
      );

      await expect(
        service.reportProblem(LAB_ID, PICKUP_ID, OTHER_USER_ID, 'CLINIC_CLOSED')
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an invalid reason', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'ACCEPTED', messengerId: MESSENGER_ID })
      );

      await expect(
        service.reportProblem(LAB_ID, PICKUP_ID, MESSENGER_ID, 'NOT_A_REASON')
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a PROBLEM_REPORTED timeline event without changing status', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'ACCEPTED', messengerId: MESSENGER_ID })
      );

      const result = await service.reportProblem(
        LAB_ID,
        PICKUP_ID,
        MESSENGER_ID,
        'SAMPLE_NOT_READY'
      );

      expect(result).toEqual({ reported: true });
      expect(prisma.pickup.update).not.toHaveBeenCalled();
      expect(prisma.timelineEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'PROBLEM_REPORTED',
            metadata: { reason: 'SAMPLE_NOT_READY', details: null },
          }),
        })
      );
    });
  });

  describe('confirmReceived', () => {
    it('is idempotent when already RECEIVED_AT_LAB', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'RECEIVED_AT_LAB' })
      );

      const result = await service.confirmReceived(LAB_ID, PICKUP_ID, ADMIN_ID);

      expect(result.status).toBe('RECEIVED_AT_LAB');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when not IN_TRANSIT', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'ACCEPTED' })
      );

      await expect(
        service.confirmReceived(LAB_ID, PICKUP_ID, ADMIN_ID)
      ).rejects.toThrow(BadRequestException);
    });

    it('transitions IN_TRANSIT -> RECEIVED_AT_LAB and updates Order.receivedByLabAt', async () => {
      prisma.pickup.findFirst
        .mockResolvedValueOnce(makePickup({ status: 'IN_TRANSIT' }))
        .mockResolvedValueOnce(makePickup({ status: 'RECEIVED_AT_LAB' }));

      const result = await service.confirmReceived(LAB_ID, PICKUP_ID, ADMIN_ID);

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: expect.objectContaining({ receivedByLabAt: expect.any(Date) }),
        })
      );
      expect(result.status).toBe('RECEIVED_AT_LAB');
    });
  });

  describe('cancelPickup', () => {
    it('rejects cancelling an already-terminal pickup', async () => {
      prisma.pickup.findFirst.mockResolvedValue(
        makePickup({ status: 'RECEIVED_AT_LAB' })
      );

      await expect(
        service.cancelPickup(LAB_ID, PICKUP_ID, ADMIN_ID, 'no longer needed')
      ).rejects.toThrow(BadRequestException);
    });

    it('cancels a non-terminal pickup', async () => {
      prisma.pickup.findFirst
        .mockResolvedValueOnce(makePickup({ status: 'REQUESTED' }))
        .mockResolvedValueOnce(makePickup({ status: 'CANCELLED' }));

      const result = await service.cancelPickup(
        LAB_ID,
        PICKUP_ID,
        ADMIN_ID,
        'clinic cancelled the order'
      );

      expect(prisma.pickup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED' }),
        })
      );
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('getPickupById', () => {
    it('throws NotFoundException when not found for this lab', async () => {
      prisma.pickup.findFirst.mockResolvedValue(null);

      await expect(service.getPickupById(LAB_ID, PICKUP_ID)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('listPickups', () => {
    it('defaults to active statuses only, excluding completed/cancelled history', async () => {
      prisma.pickup.findMany.mockResolvedValue([]);
      prisma.pickup.count.mockResolvedValue(0);

      await service.listPickups(LAB_ID, {});

      expect(prisma.pickup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              expect.objectContaining({
                status: {
                  in: [
                    'REQUESTED',
                    'ASSIGNED',
                    'NOTIFIED',
                    'ACCEPTED',
                    'COLLECTED',
                    'IN_TRANSIT',
                  ],
                },
              }),
            ],
          },
        })
      );
    });

    it('uses an explicit status filter (e.g. history) when provided', async () => {
      prisma.pickup.findMany.mockResolvedValue([]);
      prisma.pickup.count.mockResolvedValue(0);

      await service.listPickups(LAB_ID, {
        status: 'RECEIVED_AT_LAB,CANCELLED,FAILED',
      });

      expect(prisma.pickup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              expect.objectContaining({
                status: { in: ['RECEIVED_AT_LAB', 'CANCELLED', 'FAILED'] },
              }),
            ],
          },
        })
      );
    });

    it('filters by messengerId when provided', async () => {
      prisma.pickup.findMany.mockResolvedValue([]);
      prisma.pickup.count.mockResolvedValue(0);

      await service.listPickups(LAB_ID, { messengerId: MESSENGER_ID });

      expect(prisma.pickup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [expect.objectContaining({ messengerId: MESSENGER_ID })],
          },
        })
      );
    });

    it('filters by an inclusive createdAt date range', async () => {
      prisma.pickup.findMany.mockResolvedValue([]);
      prisma.pickup.count.mockResolvedValue(0);

      await service.listPickups(LAB_ID, {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-08',
      });

      expect(prisma.pickup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              expect.objectContaining({
                createdAt: {
                  gte: new Date('2026-08-01'),
                  lte: new Date('2026-08-08T23:59:59.999Z'),
                },
              }),
            ],
          },
        })
      );
    });

    it('searches by patient name in addition to requisition/clinic/messenger', async () => {
      prisma.pickup.findMany.mockResolvedValue([]);
      prisma.pickup.count.mockResolvedValue(0);

      await service.listPickups(LAB_ID, { search: 'Luna' });

      const where = (prisma.pickup.findMany as jest.Mock).mock.calls[0][0]
        .where;
      const searchCondition = where.AND[1];
      expect(searchCondition.OR).toContainEqual({
        order: {
          case: { patientName: { contains: 'Luna', mode: 'insensitive' } },
        },
      });
    });
  });

  describe('getMyPickups', () => {
    it('defaults to active statuses only for this messenger', async () => {
      prisma.pickup.findMany.mockResolvedValue([]);

      await service.getMyPickups(LAB_ID, MESSENGER_ID);

      expect(prisma.pickup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            labTenantId: LAB_ID,
            messengerId: MESSENGER_ID,
            status: {
              in: [
                'REQUESTED',
                'ASSIGNED',
                'NOTIFIED',
                'ACCEPTED',
                'COLLECTED',
                'IN_TRANSIT',
              ],
            },
          },
        })
      );
    });

    it('returns history when an explicit status filter is passed', async () => {
      prisma.pickup.findMany.mockResolvedValue([]);

      await service.getMyPickups(LAB_ID, MESSENGER_ID, {
        status: 'RECEIVED_AT_LAB,CANCELLED,FAILED',
      });

      expect(prisma.pickup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            labTenantId: LAB_ID,
            messengerId: MESSENGER_ID,
            status: { in: ['RECEIVED_AT_LAB', 'CANCELLED', 'FAILED'] },
          },
        })
      );
    });
  });
});
