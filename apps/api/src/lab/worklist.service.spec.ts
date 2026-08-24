import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorklistService } from './worklist.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WorklistService', () => {
  let service: WorklistService;
  let prisma: Record<string, any>;

  const labTenantId = 'lab-1';
  const userId = 'user-1';
  const otherUserId = 'user-2';

  const mockTest = {
    id: 'test-1',
    orderId: 'order-1',
    catalogItemName: 'CBC',
    catalogItemCode: 'CBC',
    status: 'READY',
    department: 'HEMATOLOGY',
    processingMethod: 'MANUAL',
    version: 1,
    claimedAt: null,
    startedAt: null,
    createdAt: new Date(),
    blockReason: null,
    blockReasonDetail: null,
    assignedUserId: null,
    order: {
      requisitionNumber: 'REQ-2026-000001',
      priority: 'ROUTINE',
      status: 'RECEIVED_BY_LAB',
      case: { patientName: 'Luna', patientSpecies: 'DOG', ownerName: 'Jane' },
      tenant: { name: 'Pet Clinic' },
    },
    assignedTo: null,
    analyzer: null,
    specimens: [],
  };

  beforeEach(async () => {
    prisma = {
      orderedTest: {
        findMany: jest.fn().mockResolvedValue([mockTest]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      order: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      timelineEvent: { create: jest.fn() },
      userTenantMembership: { findUnique: jest.fn() },
      $transaction: jest.fn((args: unknown[]) => Promise.all(args)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorklistService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WorklistService>(WorklistService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // getWorklist
  // -----------------------------------------------------------------------

  describe('getWorklist', () => {
    it('returns paginated results with correct shape', async () => {
      const result = await service.getWorklist(labTenantId, {});
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 'test-1',
        catalogItemName: 'CBC',
        patientName: 'Luna',
        clinicName: 'Pet Clinic',
        requisitionNumber: 'REQ-2026-000001',
      });
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('filters by department', async () => {
      await service.getWorklist(labTenantId, { department: 'HEMATOLOGY' });
      const where = prisma.orderedTest.findMany.mock.calls[0][0].where;
      expect(where.department).toBe('HEMATOLOGY');
    });

    it('filters by assignment — unassigned', async () => {
      await service.getWorklist(labTenantId, { assignmentFilter: 'unassigned' });
      const where = prisma.orderedTest.findMany.mock.calls[0][0].where;
      expect(where.assignedUserId).toBeNull();
    });

    it('filters by assignment — mine', async () => {
      await service.getWorklist(labTenantId, { assignmentFilter: 'mine' }, userId);
      const where = prisma.orderedTest.findMany.mock.calls[0][0].where;
      expect(where.assignedUserId).toBe(userId);
    });

    it('applies search filter', async () => {
      await service.getWorklist(labTenantId, { search: 'Luna' });
      const where = prisma.orderedTest.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeDefined();
      expect(where.OR).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // getReadyCount
  // -----------------------------------------------------------------------

  describe('getReadyCount', () => {
    it('returns count of READY unassigned tests for the tenant', async () => {
      prisma.orderedTest.count.mockResolvedValue(7);

      const result = await service.getReadyCount(labTenantId);

      expect(result).toEqual({ count: 7 });
      expect(prisma.orderedTest.count).toHaveBeenCalledWith({
        where: {
          order: { labTenantId },
          status: 'READY',
          assignedUserId: null,
        },
      });
    });

    it('scopes query to the given tenantId', async () => {
      prisma.orderedTest.count.mockResolvedValue(0);

      await service.getReadyCount('other-lab');

      const where = prisma.orderedTest.count.mock.calls[0][0].where;
      expect(where.order.labTenantId).toBe('other-lab');
    });

    it('excludes assigned tests', async () => {
      prisma.orderedTest.count.mockResolvedValue(0);

      await service.getReadyCount(labTenantId);

      const where = prisma.orderedTest.count.mock.calls[0][0].where;
      expect(where.assignedUserId).toBeNull();
    });

    it('counts only READY status, not IN_PROGRESS', async () => {
      prisma.orderedTest.count.mockResolvedValue(0);

      await service.getReadyCount(labTenantId);

      const where = prisma.orderedTest.count.mock.calls[0][0].where;
      expect(where.status).toBe('READY');
    });

    it('returns zero when no tests match', async () => {
      prisma.orderedTest.count.mockResolvedValue(0);

      const result = await service.getReadyCount(labTenantId);
      expect(result).toEqual({ count: 0 });
    });
  });

  // -----------------------------------------------------------------------
  // getWorklistCounts
  // -----------------------------------------------------------------------

  describe('getWorklistCounts', () => {
    it('returns per-department counts', async () => {
      prisma.orderedTest.groupBy
        .mockResolvedValueOnce([
          { department: 'HEMATOLOGY', status: 'READY', _count: 3 },
          { department: 'HEMATOLOGY', status: 'IN_PROGRESS', _count: 1 },
          { department: 'CHEMISTRY', status: 'READY', _count: 5 },
        ])
        .mockResolvedValueOnce([]);
      prisma.orderedTest.count.mockResolvedValueOnce(6);

      const result = await service.getWorklistCounts(labTenantId);
      expect(result.departments).toHaveLength(2);
      const hema = result.departments.find(d => d.department === 'HEMATOLOGY');
      expect(hema).toMatchObject({ ready: 3, inProgress: 1, total: 4 });
      expect(result.totalReady).toBe(6);
    });
  });

  // -----------------------------------------------------------------------
  // claimTest
  // -----------------------------------------------------------------------

  describe('claimTest', () => {
    it('claims an unassigned READY test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: null, version: 1,
      });
      prisma.orderedTest.updateMany.mockResolvedValue({ count: 1 });
      prisma.orderedTest.findUniqueOrThrow.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: userId, version: 2, claimedAt: new Date(),
      });

      const result = await service.claimTest(labTenantId, 'test-1', userId, 1);
      expect(result.assignedUserId).toBe(userId);
      expect(prisma.orderedTest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'test-1', version: 1, assignedUserId: null },
        })
      );
    });

    it('throws ConflictException on version mismatch', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: null, version: 2,
      });
      prisma.orderedTest.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.claimTest(labTenantId, 'test-1', userId, 1)
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when test already claimed', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: otherUserId, version: 1,
      });

      await expect(
        service.claimTest(labTenantId, 'test-1', userId, 1)
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when test status not READY/IN_PROGRESS', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', status: 'COMPLETED', assignedUserId: null, version: 1,
      });

      await expect(
        service.claimTest(labTenantId, 'test-1', userId, 1)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for unknown test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue(null);

      await expect(
        service.claimTest(labTenantId, 'test-999', userId, 1)
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -----------------------------------------------------------------------
  // unclaimTest
  // -----------------------------------------------------------------------

  describe('unclaimTest', () => {
    it('allows self-unclaim', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: userId, version: 1, startedAt: null,
      });
      prisma.orderedTest.update.mockResolvedValue({});
      prisma.orderedTest.findUniqueOrThrow.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: null, version: 2, claimedAt: null,
      });

      const result = await service.unclaimTest(labTenantId, 'test-1', userId, 'TECHNICIAN');
      expect(result.assignedUserId).toBeNull();
    });

    it('allows ADMIN to unclaim another user test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: otherUserId, version: 1, startedAt: null,
      });
      prisma.orderedTest.update.mockResolvedValue({});
      prisma.orderedTest.findUniqueOrThrow.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: null, version: 2, claimedAt: null,
      });

      const result = await service.unclaimTest(labTenantId, 'test-1', userId, 'ADMIN');
      expect(result.assignedUserId).toBeNull();
    });

    it('rejects TECHNICIAN unclaiming another user test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: otherUserId, version: 1, startedAt: null,
      });

      await expect(
        service.unclaimTest(labTenantId, 'test-1', userId, 'TECHNICIAN')
      ).rejects.toThrow(ForbiddenException);
    });

    it('reverts IN_PROGRESS to READY when owner unclaims', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', status: 'IN_PROGRESS', assignedUserId: userId, version: 1, startedAt: new Date(),
      });
      prisma.orderedTest.update.mockResolvedValue({});
      prisma.orderedTest.findUniqueOrThrow.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: null, version: 2, claimedAt: null,
      });

      await service.unclaimTest(labTenantId, 'test-1', userId, 'TECHNICIAN');

      expect(prisma.orderedTest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'READY', startedAt: null }),
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // startTest
  // -----------------------------------------------------------------------

  describe('startTest', () => {
    it('starts a READY test claimed by the user', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', orderId: 'order-1', status: 'READY', assignedUserId: userId, version: 1, catalogItemName: 'CBC',
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: 'RECEIVED_BY_LAB' });
      prisma.order.update.mockResolvedValue({});
      prisma.orderedTest.findUniqueOrThrow.mockResolvedValue({
        id: 'test-1', status: 'IN_PROGRESS', assignedUserId: userId, version: 2, startedAt: new Date(),
      });

      const result = await service.startTest(labTenantId, 'test-1', userId);
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('rejects start when test not claimed by user', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', orderId: 'order-1', status: 'READY', assignedUserId: otherUserId, version: 1, catalogItemName: 'CBC',
      });

      await expect(
        service.startTest(labTenantId, 'test-1', userId)
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects start when test not READY', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', orderId: 'order-1', status: 'IN_PROGRESS', assignedUserId: userId, version: 1, catalogItemName: 'CBC',
      });

      await expect(
        service.startTest(labTenantId, 'test-1', userId)
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -----------------------------------------------------------------------
  // reassignTest
  // -----------------------------------------------------------------------

  describe('reassignTest', () => {
    it('reassigns to a valid lab member', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', version: 1, status: 'READY',
      });
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        role: 'TECHNICIAN',
      });
      prisma.orderedTest.updateMany.mockResolvedValue({ count: 1 });
      prisma.orderedTest.findUniqueOrThrow.mockResolvedValue({
        id: 'test-1', status: 'READY', assignedUserId: otherUserId, version: 2, claimedAt: new Date(),
      });

      const result = await service.reassignTest(labTenantId, 'test-1', otherUserId, 1);
      expect(result.assignedUserId).toBe(otherUserId);
    });

    it('rejects reassign to non-lab-member', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', version: 1, status: 'READY',
      });
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.reassignTest(labTenantId, 'test-1', 'unknown-user', 1)
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects reassign to MESSENGER role', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', version: 1, status: 'READY',
      });
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        role: 'MESSENGER',
      });

      await expect(
        service.reassignTest(labTenantId, 'test-1', otherUserId, 1)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on version mismatch', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1', version: 2, status: 'READY',
      });
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        role: 'TECHNICIAN',
      });
      prisma.orderedTest.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reassignTest(labTenantId, 'test-1', otherUserId, 1)
      ).rejects.toThrow(ConflictException);
    });
  });
});
