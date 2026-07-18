import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderAttentionService } from './order-attention.service';
import { PrismaService } from '../prisma/prisma.service';

const LAB_TENANT_ID = 'lab-tenant-1';

const baseOrder = {
  id: 'order-1',
  requisitionNumber: 'REQ-2026-000001',
  status: 'PENDING',
  priority: 'ROUTINE',
  createdAt: new Date(),
  receivedByLabAt: null,
  processingStartedAt: null,
  case: { patientName: 'Max', patientSpecies: 'DOG' },
  tenant: { name: 'Clínica Veterinaria Demo' },
  resultReport: null,
};

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe('OrderAttentionService', () => {
  let service: OrderAttentionService;
  let prisma: { order: { findMany: jest.Mock } };
  let configGet: jest.Mock;

  beforeEach(async () => {
    prisma = { order: { findMany: jest.fn() } };
    configGet = jest.fn((_key: string, defaultValue?: number) => defaultValue);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderAttentionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = module.get(OrderAttentionService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  it('scopes the query to the given labTenantId', async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ labTenantId: LAB_TENANT_ID }),
      })
    );
  });

  it('excludes orders that match no rule', async () => {
    prisma.order.findMany.mockResolvedValue([{ ...baseOrder }]);

    const result = await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(result).toHaveLength(0);
  });

  it('flags STAT priority orders as CRITICAL', async () => {
    prisma.order.findMany.mockResolvedValue([
      { ...baseOrder, priority: 'STAT', status: 'PROCESSING' },
    ]);

    const [order] = await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(order.severity).toBe('CRITICAL');
    expect(order.attentionReasons).toEqual([
      expect.objectContaining({ code: 'STAT_PRIORITY', severity: 'CRITICAL' }),
    ]);
  });

  it('flags URGENT priority orders as HIGH', async () => {
    prisma.order.findMany.mockResolvedValue([
      { ...baseOrder, priority: 'URGENT', status: 'PROCESSING' },
    ]);

    const [order] = await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(order.severity).toBe('HIGH');
    expect(order.attentionReasons).toEqual([
      expect.objectContaining({ code: 'URGENT_PRIORITY', severity: 'HIGH' }),
    ]);
  });

  it('flags a PENDING order past the pending SLA using createdAt', async () => {
    prisma.order.findMany.mockResolvedValue([
      { ...baseOrder, status: 'PENDING', createdAt: hoursAgo(5) },
    ]);

    const [order] = await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(order.attentionReasons).toEqual([
      expect.objectContaining({
        code: 'SLA_BREACH_PENDING',
        elapsedMinutes: expect.any(Number),
        thresholdMinutes: 240,
      }),
    ]);
  });

  it('flags a RECEIVED_BY_LAB order past its SLA using receivedByLabAt, not createdAt', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        ...baseOrder,
        status: 'RECEIVED_BY_LAB',
        createdAt: hoursAgo(1), // order itself is young
        receivedByLabAt: hoursAgo(5), // but stuck in this stage for 5h
      },
    ]);

    const [order] = await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(order.attentionReasons).toEqual([
      expect.objectContaining({ code: 'SLA_BREACH_RECEIVED' }),
    ]);
  });

  it('flags a PROCESSING order past its SLA using processingStartedAt', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        ...baseOrder,
        status: 'PROCESSING',
        createdAt: hoursAgo(1),
        processingStartedAt: hoursAgo(9),
      },
    ]);

    const [order] = await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(order.attentionReasons).toEqual([
      expect.objectContaining({ code: 'SLA_BREACH_PROCESSING' }),
    ]);
  });

  it('flags an unreviewed abnormal result as HIGH, not CRITICAL', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        ...baseOrder,
        status: 'PROCESSING',
        resultReport: { status: 'DRAFT', analytes: [{ flag: 'H' }] },
      },
    ]);

    const [order] = await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(order.severity).toBe('HIGH');
    expect(order.attentionReasons).toEqual([
      expect.objectContaining({
        code: 'UNREVIEWED_ABNORMAL_RESULT',
        severity: 'HIGH',
      }),
    ]);
  });

  it('does not flag a RELEASED report even with abnormal flags', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        ...baseOrder,
        status: 'PROCESSING',
        resultReport: { status: 'RELEASED', analytes: [{ flag: 'H' }] },
      },
    ]);

    const result = await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(result).toHaveLength(0);
  });

  it('takes the max severity across multiple matched reasons', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        ...baseOrder,
        priority: 'STAT',
        status: 'PENDING',
        createdAt: hoursAgo(5),
      },
    ]);

    const [order] = await service.getOrdersNeedingAttention(LAB_TENANT_ID);

    expect(order.severity).toBe('CRITICAL');
    expect(order.attentionReasons).toHaveLength(2);
  });
});
