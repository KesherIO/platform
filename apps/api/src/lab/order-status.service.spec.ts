import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatusService } from './order-status.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OrderStatusService', () => {
  let service: OrderStatusService;
  let prisma: {
    order: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    orderedTest: { findMany: jest.Mock };
    specimen: { findMany: jest.Mock };
    case: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      order: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      orderedTest: { findMany: jest.fn() },
      specimen: { findMany: jest.fn() },
      case: { findUnique: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderStatusService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<OrderStatusService>(OrderStatusService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('deriveOrderStatus', () => {
    it('returns COMPLETED when all tests are in terminal states', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: 'PROCESSING',
      });
      prisma.orderedTest.findMany.mockResolvedValue([
        { status: 'COMPLETED' },
        { status: 'CANCELLED' },
        { status: 'COMPLETED' },
      ]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'ACCEPTED' }]);

      const result = await service.deriveOrderStatus('order-1');
      expect(result).toBe('COMPLETED');
    });

    it('returns COMPLETED when all tests are COMPLETED (no CANCELLED)', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: 'PROCESSING',
      });
      prisma.orderedTest.findMany.mockResolvedValue([
        { status: 'COMPLETED' },
        { status: 'COMPLETED' },
      ]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'ACCEPTED' }]);

      const result = await service.deriveOrderStatus('order-1');
      expect(result).toBe('COMPLETED');
    });

    it('does NOT return COMPLETED when a BLOCKED test exists among COMPLETED', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: 'PROCESSING',
      });
      prisma.orderedTest.findMany.mockResolvedValue([
        { status: 'COMPLETED' },
        { status: 'BLOCKED' },
        { status: 'COMPLETED' },
      ]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'ACCEPTED' }]);

      const result = await service.deriveOrderStatus('order-1');
      expect(result).not.toBe('COMPLETED');
    });

    it('returns PROCESSING when any test is IN_PROGRESS', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: 'RECEIVED_BY_LAB',
      });
      prisma.orderedTest.findMany.mockResolvedValue([
        { status: 'IN_PROGRESS' },
        { status: 'PENDING' },
      ]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'ACCEPTED' }]);

      const result = await service.deriveOrderStatus('order-1');
      expect(result).toBe('PROCESSING');
    });

    it('returns PENDING when no tests exist', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: 'PENDING' });
      prisma.orderedTest.findMany.mockResolvedValue([]);
      prisma.specimen.findMany.mockResolvedValue([]);

      const result = await service.deriveOrderStatus('order-1');
      expect(result).toBe('PENDING');
    });

    it('preserves CANCELLED when order is already cancelled', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: 'CANCELLED' });

      const result = await service.deriveOrderStatus('order-1');
      expect(result).toBe('CANCELLED');
      expect(prisma.orderedTest.findMany).not.toHaveBeenCalled();
    });

    it('returns RECEIVED_BY_LAB when all specimens accepted and no processing tests', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: 'PENDING' });
      prisma.orderedTest.findMany.mockResolvedValue([
        { status: 'READY' },
        { status: 'PENDING' },
      ]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'ACCEPTED' }]);

      const result = await service.deriveOrderStatus('order-1');
      expect(result).toBe('RECEIVED_BY_LAB');
    });
  });

  describe('deriveAndPersist', () => {
    it('updates order and case to COMPLETED when all tests terminal', async () => {
      prisma.order.findUniqueOrThrow
        .mockResolvedValueOnce({ status: 'PROCESSING' })
        .mockResolvedValueOnce({ status: 'PROCESSING', caseId: 'case-1' });
      prisma.orderedTest.findMany.mockResolvedValue([
        { status: 'COMPLETED' },
        { status: 'COMPLETED' },
      ]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'ACCEPTED' }]);
      prisma.order.update.mockResolvedValue({});
      prisma.case.findUnique.mockResolvedValue({ status: 'ORDERED' });
      prisma.case.update.mockResolvedValue({});

      const result = await service.deriveAndPersist('order-1');

      expect(result.orderStatus).toBe('COMPLETED');
      expect(result.caseStatus).toBe('COMPLETED');
      expect(result.changed).toBe(true);
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        })
      );
      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'case-1' },
          data: { status: 'COMPLETED' },
        })
      );
    });

    it('does not update case if already COMPLETED', async () => {
      prisma.order.findUniqueOrThrow
        .mockResolvedValueOnce({ status: 'PROCESSING' })
        .mockResolvedValueOnce({ status: 'PROCESSING', caseId: 'case-1' });
      prisma.orderedTest.findMany.mockResolvedValue([{ status: 'COMPLETED' }]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'ACCEPTED' }]);
      prisma.order.update.mockResolvedValue({});
      prisma.case.findUnique.mockResolvedValue({ status: 'COMPLETED' });

      const result = await service.deriveAndPersist('order-1');

      expect(result.caseStatus).toBeNull();
      expect(prisma.case.update).not.toHaveBeenCalled();
    });

    it('does not update order if status unchanged', async () => {
      prisma.order.findUniqueOrThrow
        .mockResolvedValueOnce({ status: 'PENDING' })
        .mockResolvedValueOnce({ status: 'PENDING', caseId: 'case-1' });
      prisma.orderedTest.findMany.mockResolvedValue([{ status: 'PENDING' }]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'EXPECTED' }]);

      const result = await service.deriveAndPersist('order-1');

      expect(result.changed).toBe(false);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });
});
