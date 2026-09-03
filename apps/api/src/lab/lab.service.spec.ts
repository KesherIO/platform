import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { LabService } from './lab.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatusService } from './order-status.service';

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
      catalogItemComposition: {
        findMany: jest.fn(),
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

    const orderStatusMock = {
      deriveOrderStatus: jest.fn(),
      deriveAndPersist: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: OrderStatusService, useValue: orderStatusMock },
      ],
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

  describe('initOrderedTests', () => {
    it('throws NotFoundException when order is not found', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.initOrderedTests(LAB_TENANT_ID, ORDER_ID)
      ).rejects.toThrow(NotFoundException);
    });

    it('returns early if ordered tests already exist (idempotency)', async () => {
      const existingTests = [{ id: 'existing-test-1' }];
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        ...mockOrder,
        orderedTests: existingTests,
      });

      const result = await service.initOrderedTests(LAB_TENANT_ID, ORDER_ID);

      expect(result).toBe(existingTests);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates one OrderedTest with a DIRECT source for a standalone TEST item', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        ...mockOrder,
        orderedItems: [
          {
            catalogItemId: 'cat-1',
            code: 'CBC',
            name: 'Hemograma',
            kind: 'TEST',
          },
        ],
        orderedTests: [],
      });
      (prisma.orderedTest.create as jest.Mock).mockResolvedValue({
        id: 'ot-1',
        catalogItemId: 'cat-1',
      });
      (prisma.$transaction as jest.Mock).mockImplementation((promises) =>
        Promise.all(promises)
      );

      await service.initOrderedTests(LAB_TENANT_ID, ORDER_ID);

      expect(prisma.catalogItemComposition.findMany).not.toHaveBeenCalled();
      expect(prisma.orderedTest.create).toHaveBeenCalledTimes(1);
      expect(prisma.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: ORDER_ID,
            catalogItemId: 'cat-1',
            catalogItemCode: 'CBC',
            catalogItemName: 'Hemograma',
            sources: {
              create: [
                expect.objectContaining({
                  sourceType: 'DIRECT',
                  originalOrderItemKey: 'line-0',
                  originalOrderItemIndex: 0,
                  originCode: 'CBC',
                  originName: 'Hemograma',
                }),
              ],
            },
          }),
          include: { sources: true },
        })
      );
    });

    it('expands a PACKAGE into component OrderedTests with PACKAGE sources', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        ...mockOrder,
        orderedItems: [
          {
            catalogItemId: 'pkg-1',
            code: 'BASIC',
            name: 'Perfil Básico',
            kind: 'PACKAGE',
          },
        ],
        orderedTests: [],
      });
      (prisma.catalogItemComposition.findMany as jest.Mock).mockResolvedValue([
        {
          packageId: 'pkg-1',
          componentId: 'comp-alb',
          component: { id: 'comp-alb', code: 'ALB', name: 'Albumina' },
        },
        {
          packageId: 'pkg-1',
          componentId: 'comp-glu',
          component: { id: 'comp-glu', code: 'GLU', name: 'Glucosa' },
        },
      ]);
      (prisma.orderedTest.create as jest.Mock).mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation((promises) =>
        Promise.all(promises)
      );

      await service.initOrderedTests(LAB_TENANT_ID, ORDER_ID);

      expect(prisma.catalogItemComposition.findMany).toHaveBeenCalledWith({
        where: { packageId: { in: ['pkg-1'] } },
        include: {
          component: { select: { id: true, code: true, name: true } },
        },
      });
      expect(prisma.orderedTest.create).toHaveBeenCalledTimes(2);

      // ALB — component from the package
      expect(prisma.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            catalogItemId: 'comp-alb',
            catalogItemCode: 'ALB',
            catalogItemName: 'Albumina',
            sources: {
              create: [
                expect.objectContaining({
                  sourceType: 'PACKAGE',
                  originalOrderItemKey: 'line-0',
                  originCode: 'BASIC',
                  originName: 'Perfil Básico',
                }),
              ],
            },
          }),
        })
      );

      // GLU — component from the package
      expect(prisma.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            catalogItemId: 'comp-glu',
            catalogItemCode: 'GLU',
            catalogItemName: 'Glucosa',
            sources: {
              create: [
                expect.objectContaining({
                  sourceType: 'PACKAGE',
                  originName: 'Perfil Básico',
                }),
              ],
            },
          }),
        })
      );
    });

    it('deduplicates when a component test is also ordered directly', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        ...mockOrder,
        orderedItems: [
          {
            catalogItemId: 'pkg-1',
            code: 'BASIC',
            name: 'Perfil Básico',
            kind: 'PACKAGE',
          },
          {
            catalogItemId: 'comp-crea',
            code: 'CREA',
            name: 'Creatinina',
            kind: 'TEST',
          },
        ],
        orderedTests: [],
      });
      (prisma.catalogItemComposition.findMany as jest.Mock).mockResolvedValue([
        {
          packageId: 'pkg-1',
          componentId: 'comp-alb',
          component: { id: 'comp-alb', code: 'ALB', name: 'Albumina' },
        },
        {
          packageId: 'pkg-1',
          componentId: 'comp-crea',
          component: { id: 'comp-crea', code: 'CREA', name: 'Creatinina' },
        },
      ]);
      (prisma.orderedTest.create as jest.Mock).mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation((promises) =>
        Promise.all(promises)
      );

      await service.initOrderedTests(LAB_TENANT_ID, ORDER_ID);

      // ALB (from package only) + CREA (deduplicated: package + direct) = 2 OrderedTests
      expect(prisma.orderedTest.create).toHaveBeenCalledTimes(2);

      // CREA should have two sources: PACKAGE from Perfil Básico + DIRECT
      expect(prisma.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            catalogItemId: 'comp-crea',
            catalogItemName: 'Creatinina',
            sources: {
              create: [
                expect.objectContaining({
                  sourceType: 'PACKAGE',
                  originalOrderItemKey: 'line-0',
                  originName: 'Perfil Básico',
                }),
                expect.objectContaining({
                  sourceType: 'DIRECT',
                  originalOrderItemKey: 'line-1',
                  originName: 'Creatinina',
                }),
              ],
            },
          }),
        })
      );
    });

    it('handles mixed packages and standalone tests preserving correct line indices', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        ...mockOrder,
        orderedItems: [
          {
            catalogItemId: 'cat-cbc',
            code: 'CBC',
            name: 'Hemograma',
            kind: 'TEST',
          },
          {
            catalogItemId: 'pkg-1',
            code: 'BASIC',
            name: 'Perfil Básico',
            kind: 'PACKAGE',
          },
          {
            catalogItemId: 'cat-uri',
            code: 'URI',
            name: 'Urianálisis',
            kind: 'TEST',
          },
        ],
        orderedTests: [],
      });
      (prisma.catalogItemComposition.findMany as jest.Mock).mockResolvedValue([
        {
          packageId: 'pkg-1',
          componentId: 'comp-alb',
          component: { id: 'comp-alb', code: 'ALB', name: 'Albumina' },
        },
      ]);
      (prisma.orderedTest.create as jest.Mock).mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation((promises) =>
        Promise.all(promises)
      );

      await service.initOrderedTests(LAB_TENANT_ID, ORDER_ID);

      // CBC (line-0, DIRECT) + ALB (line-1, PACKAGE) + URI (line-2, DIRECT) = 3 tests
      expect(prisma.orderedTest.create).toHaveBeenCalledTimes(3);

      // CBC — standalone at index 0
      expect(prisma.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            catalogItemId: 'cat-cbc',
            sources: {
              create: [
                expect.objectContaining({
                  sourceType: 'DIRECT',
                  originalOrderItemKey: 'line-0',
                  originalOrderItemIndex: 0,
                }),
              ],
            },
          }),
        })
      );

      // ALB — from package at index 1
      expect(prisma.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            catalogItemId: 'comp-alb',
            sources: {
              create: [
                expect.objectContaining({
                  sourceType: 'PACKAGE',
                  originalOrderItemKey: 'line-1',
                  originalOrderItemIndex: 1,
                }),
              ],
            },
          }),
        })
      );

      // URI — standalone at index 2
      expect(prisma.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            catalogItemId: 'cat-uri',
            sources: {
              create: [
                expect.objectContaining({
                  sourceType: 'DIRECT',
                  originalOrderItemKey: 'line-2',
                  originalOrderItemIndex: 2,
                }),
              ],
            },
          }),
        })
      );
    });

    it('deduplicates a component that appears in two different packages', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        ...mockOrder,
        orderedItems: [
          {
            catalogItemId: 'pkg-renal',
            code: 'RENAL',
            name: 'Perfil Renal',
            kind: 'PACKAGE',
          },
          {
            catalogItemId: 'pkg-hepatic',
            code: 'HEPATIC',
            name: 'Perfil Hepático',
            kind: 'PACKAGE',
          },
        ],
        orderedTests: [],
      });
      (prisma.catalogItemComposition.findMany as jest.Mock).mockResolvedValue([
        {
          packageId: 'pkg-renal',
          componentId: 'comp-crea',
          component: { id: 'comp-crea', code: 'CREA', name: 'Creatinina' },
        },
        {
          packageId: 'pkg-renal',
          componentId: 'comp-bun',
          component: { id: 'comp-bun', code: 'BUN', name: 'BUN' },
        },
        {
          packageId: 'pkg-hepatic',
          componentId: 'comp-alt',
          component: { id: 'comp-alt', code: 'ALT', name: 'ALT' },
        },
        {
          packageId: 'pkg-hepatic',
          componentId: 'comp-crea',
          component: { id: 'comp-crea', code: 'CREA', name: 'Creatinina' },
        },
      ]);
      (prisma.orderedTest.create as jest.Mock).mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation((promises) =>
        Promise.all(promises)
      );

      await service.initOrderedTests(LAB_TENANT_ID, ORDER_ID);

      // CREA (deduped), BUN, ALT = 3 OrderedTests (not 4)
      expect(prisma.orderedTest.create).toHaveBeenCalledTimes(3);

      // CREA should have two PACKAGE sources
      expect(prisma.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            catalogItemId: 'comp-crea',
            sources: {
              create: [
                expect.objectContaining({
                  sourceType: 'PACKAGE',
                  originalOrderItemKey: 'line-0',
                  originName: 'Perfil Renal',
                }),
                expect.objectContaining({
                  sourceType: 'PACKAGE',
                  originalOrderItemKey: 'line-1',
                  originName: 'Perfil Hepático',
                }),
              ],
            },
          }),
        })
      );
    });

    it('skips composition query when no packages are ordered', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        ...mockOrder,
        orderedItems: [
          {
            catalogItemId: 'cat-1',
            code: 'CBC',
            name: 'Hemograma',
            kind: 'TEST',
          },
          {
            catalogItemId: 'cat-2',
            code: 'URI',
            name: 'Urianálisis',
            kind: 'TEST',
          },
        ],
        orderedTests: [],
      });
      (prisma.orderedTest.create as jest.Mock).mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation((promises) =>
        Promise.all(promises)
      );

      await service.initOrderedTests(LAB_TENANT_ID, ORDER_ID);

      expect(prisma.catalogItemComposition.findMany).not.toHaveBeenCalled();
      expect(prisma.orderedTest.create).toHaveBeenCalledTimes(2);
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
