import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
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
    counter: {
      upsert: jest.fn().mockResolvedValue({ name: 'ORDER_SEQ', value: 1 }),
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

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module = await Test.createTestingModule({
      providers: [OrdersService, { provide: PrismaService, useValue: prisma }],
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
});
