import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { PickupService } from '../lab/pickup.service';
import { ReadinessService } from '../lab/readiness.service';
import { CaseStatus } from '@prisma/client';

const MOCK_CASE = {
  id: 'case-1',
  tenantId: 'tenant-1',
  status: CaseStatus.TRIAGED,
};

const MOCK_CATALOG_ITEM = {
  id: 'ci-1',
  kind: 'TEST',
  code: 'CBC',
  name: 'Complete Blood Count',
  category: 'Hematology',
  turnaroundHours: 4,
};

const MOCK_ORDER = {
  id: 'order-1',
  requisitionNumber: 'REQ-2026-000001',
  status: 'PENDING',
  priority: 'ROUTINE',
  deliveryMethod: null,
  orderedItems: [],
  clinicNotes: null,
  createdAt: new Date(),
};

function makePrismaMock() {
  return {
    case: {
      findFirst: jest.fn().mockResolvedValue(MOCK_CASE),
      update: jest.fn().mockResolvedValue(MOCK_CASE),
    },
    order: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(MOCK_ORDER),
    },
    caseCatalogItem: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ catalogItem: MOCK_CATALOG_ITEM }]),
    },
    clinicLabConnection: {
      findFirst: jest.fn().mockResolvedValue({ labId: 'lab-tenant-1' }),
    },
    counter: {
      upsert: jest.fn().mockResolvedValue({ name: 'ORDER_SEQ', value: 1 }),
    },
    timelineEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        pickupAddress: null,
        pickupContactName: null,
        pickupContactPhone: null,
        pickupInstructions: null,
      }),
    },
    $transaction: jest
      .fn()
      .mockImplementation(
        (cb: (tx: ReturnType<typeof makePrismaMock>) => Promise<unknown>) =>
          cb(makePrismaMock())
      ),
  };
}

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let pickupService: { createPickup: jest.Mock };
  let readinessService: { checkBulkReadiness: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    pickupService = { createPickup: jest.fn().mockResolvedValue({}) };
    readinessService = {
      checkBulkReadiness: jest.fn().mockResolvedValue({
        items: [{ catalogItemId: 'ci-1', ready: true, reasons: [] }],
        summary: { total: 1, ready: 1, notReady: 0 },
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PickupService, useValue: pickupService },
        { provide: ReadinessService, useValue: readinessService },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  it('creates without error', () => {
    expect(service).toBeTruthy();
  });

  it('creates an order and returns formatted response', async () => {
    const result = await service.createOrderForCase('tenant-1', 'case-1', {});
    expect(result.status).toBe('PENDING');
    expect(result.requisitionNumber).toBe('REQ-2026-000001');
    expect(result.requisitionUrl).toContain('/api/orders/');
  });

  it('throws NotFoundException when case does not exist', async () => {
    prisma.case.findFirst.mockResolvedValue(null);
    await expect(
      service.createOrderForCase('tenant-1', 'bad-id', {})
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when case status is not orderable', async () => {
    prisma.case.findFirst.mockResolvedValue({
      ...MOCK_CASE,
      status: CaseStatus.ORDERED,
    });
    await expect(
      service.createOrderForCase('tenant-1', 'case-1', {})
    ).rejects.toThrow(BadRequestException);
  });

  it('throws ConflictException when order already exists for case', async () => {
    prisma.order.findUnique.mockResolvedValue(MOCK_ORDER);
    await expect(
      service.createOrderForCase('tenant-1', 'case-1', {})
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException when no catalog items are selected', async () => {
    prisma.caseCatalogItem.findMany.mockResolvedValue([]);
    await expect(
      service.createOrderForCase('tenant-1', 'case-1', {})
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects package with unready component, grouped by package', async () => {
    const pkgItem = {
      id: 'pkg-1',
      kind: 'PACKAGE',
      code: 'HEMO_PKG',
      name: 'Hemogram Panel',
      category: 'Hematology',
      turnaroundHours: 4,
    };
    prisma.caseCatalogItem.findMany.mockResolvedValue([
      { catalogItem: pkgItem },
    ]);
    prisma.catalogItemComposition = {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            packageId: 'pkg-1',
            component: { id: 'comp-1', name: 'Reticulocyte Count' },
          },
        ]),
    };
    readinessService.checkBulkReadiness.mockResolvedValue({
      items: [
        { catalogItemId: 'pkg-1', ready: true, reasons: [] },
        {
          catalogItemId: 'comp-1',
          ready: false,
          reasons: [{ code: 'NO_PUBLISHED_TEMPLATE', message: 'No template' }],
        },
      ],
      summary: { total: 2, ready: 1, notReady: 1 },
    });

    try {
      await service.createOrderForCase('tenant-1', 'case-1', {});
      fail('Expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as any;
      expect(response.packages).toBeDefined();
      expect(response.packages).toHaveLength(1);
      expect(response.packages[0].packageId).toBe('pkg-1');
      expect(response.packages[0].packageName).toBe('Hemogram Panel');
      expect(response.packages[0].unreadyComponents).toHaveLength(1);
      expect(response.packages[0].unreadyComponents[0].componentName).toBe(
        'Reticulocyte Count'
      );
    }
  });
});
