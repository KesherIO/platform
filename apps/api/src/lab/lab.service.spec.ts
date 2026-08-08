import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { LabService } from './lab.service';
import { PrismaService } from '../prisma/prisma.service';

const LAB_TENANT_ID = 'lab-tenant-1';
const ORDER_ID = 'order-1';

const mockOrder = {
  id: ORDER_ID,
  requisitionNumber: 'REQ-2026-000001',
  caseId: 'case-1',
  tenantId: 'clinic-1',
  labTenantId: LAB_TENANT_ID,
  status: 'RECEIVED_BY_LAB',
  priority: 'ROUTINE',
  orderedItems: [
    { catalogItemId: 'cat-1', code: 'CBC', name: 'Hemograma', kind: 'TEST' },
  ],
  clinicNotes: null,
  labNotes: null,
  sampleType: null,
  sampleNotes: null,
  createdAt: new Date('2026-07-11'),
  updatedAt: new Date('2026-07-11'),
  receivedByLabAt: new Date('2026-07-11'),
  completedAt: null,
  cancelledAt: null,
  processingStartedAt: null,
  tenant: { name: 'Clínica Veterinaria Demo' },
  case: { patientName: 'Max', patientSpecies: 'DOG', ownerName: 'Juan Pérez' },
  orderedTests: [],
};

describe('LabService', () => {
  let service: LabService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const prismaMock = {
      order: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      orderedTest: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      laboratoryProfile: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LabService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<LabService>(LabService);
    prisma = module.get(PrismaService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('getLabOrders', () => {
    it('returns formatted orders for the lab tenant', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);
      (prisma.order.count as jest.Mock).mockResolvedValue(1);

      const result = await service.getLabOrders(LAB_TENANT_ID, {
        status: 'RECEIVED_BY_LAB',
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ labTenantId: LAB_TENANT_ID, status: 'RECEIVED_BY_LAB' }],
          },
        })
      );
      expect(result.data[0].clinicName).toBe('Clínica Veterinaria Demo');
      expect(result.data[0].patientName).toBe('Max');
      expect(result.total).toBe(1);
    });

    it('defaults "All" (no status, no date range) to unresolved orders plus completed today', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.getLabOrders(LAB_TENANT_ID, {});

      expect(prisma.tenant.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: LAB_TENANT_ID } })
      );
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                labTenantId: LAB_TENANT_ID,
                OR: [
                  { status: { not: 'COMPLETED' } },
                  {
                    status: 'COMPLETED',
                    completedAt: { gte: expect.any(Date) },
                  },
                ],
              },
            ],
          },
        })
      );
    });

    it('defaults the Completed tab to the last 7 days when no date range is given', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.getLabOrders(LAB_TENANT_ID, { status: 'COMPLETED' });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                labTenantId: LAB_TENANT_ID,
                status: 'COMPLETED',
                createdAt: { gte: expect.any(Date) },
              },
            ],
          },
        })
      );
    });

    it('shows every order in a non-Completed status regardless of age', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.getLabOrders(LAB_TENANT_ID, { status: 'PROCESSING' });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ labTenantId: LAB_TENANT_ID, status: 'PROCESSING' }],
          },
        })
      );
    });

    it('applies an explicit date range to "All", surfacing historical completed orders too', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.getLabOrders(LAB_TENANT_ID, {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-08',
      });

      expect(prisma.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                labTenantId: LAB_TENANT_ID,
                createdAt: {
                  gte: new Date('2026-08-01'),
                  lte: new Date('2026-08-08T23:59:59.999Z'),
                },
              },
            ],
          },
        })
      );
    });

    it('applies an explicit date range on top of a selected status, overriding the default lookback', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.getLabOrders(LAB_TENANT_ID, {
        status: 'COMPLETED',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                labTenantId: LAB_TENANT_ID,
                status: 'COMPLETED',
                createdAt: {
                  gte: new Date('2026-01-01'),
                  lte: new Date('2026-01-31T23:59:59.999Z'),
                },
              },
            ],
          },
        })
      );
    });

    it('searches by requisition, patient name, or clinic name', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.getLabOrders(LAB_TENANT_ID, { search: 'Luna' });

      const where = (prisma.order.findMany as jest.Mock).mock.calls[0][0].where;
      const searchCondition = where.AND[1];
      expect(searchCondition.OR).toEqual([
        { requisitionNumber: { contains: 'Luna', mode: 'insensitive' } },
        { case: { patientName: { contains: 'Luna', mode: 'insensitive' } } },
        { tenant: { name: { contains: 'Luna', mode: 'insensitive' } } },
      ]);
    });
  });

  describe('updateOrderStatus', () => {
    it('throws NotFoundException when order does not belong to lab', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateOrderStatus(LAB_TENANT_ID, ORDER_ID, {
          status: 'PROCESSING',
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for invalid status transition', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: ORDER_ID,
        status: 'COMPLETED',
      });

      await expect(
        service.updateOrderStatus(LAB_TENANT_ID, ORDER_ID, {
          status: 'PROCESSING',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('transitions order status and sets timestamp', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: ORDER_ID,
        status: 'RECEIVED_BY_LAB',
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: 'PROCESSING',
      });

      await service.updateOrderStatus(LAB_TENANT_ID, ORDER_ID, {
        status: 'PROCESSING',
      });

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PROCESSING' }),
        })
      );
    });
  });

  describe('updateOrderedTest', () => {
    it('throws NotFoundException when ordered test is not found', async () => {
      (prisma.orderedTest.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateOrderedTest(LAB_TENANT_ID, 'test-1', {
          status: 'IN_PROGRESS',
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('updates ordered test status and sets startedAt for IN_PROGRESS', async () => {
      (prisma.orderedTest.findFirst as jest.Mock).mockResolvedValue({
        id: 'test-1',
        status: 'PENDING',
        startedAt: null,
      });
      (prisma.orderedTest.update as jest.Mock).mockResolvedValue({});

      await service.updateOrderedTest(LAB_TENANT_ID, 'test-1', {
        status: 'IN_PROGRESS',
      });

      expect(prisma.orderedTest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'IN_PROGRESS',
            startedAt: expect.any(Date),
          }),
        })
      );
    });
  });
});
