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

    it.each(['EXPECTED', 'MISSING', 'REJECTED'])(
      'stays RECEIVED_BY_LAB with an accepted tube while another is %s (shown as outstanding)',
      async (other) => {
        prisma.order.findUniqueOrThrow.mockResolvedValue({
          status: 'RECEIVED_BY_LAB',
        });
        prisma.orderedTest.findMany.mockResolvedValue([
          { status: 'COMPLETED' },
          { status: 'PENDING' },
        ]);
        prisma.specimen.findMany.mockResolvedValue([
          { status: 'ACCEPTED' },
          { status: other },
        ]);

        await expect(service.deriveOrderStatus('order-1')).resolves.toBe(
          'RECEIVED_BY_LAB'
        );
      }
    );

    it('is PENDING while no tube has been accepted', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: 'PENDING' });
      prisma.orderedTest.findMany.mockResolvedValue([{ status: 'PENDING' }]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'EXPECTED' }]);

      await expect(service.deriveOrderStatus('order-1')).resolves.toBe(
        'PENDING'
      );
    });

    it('an outstanding tube never holds back completion once every test is done', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: 'PROCESSING',
      });
      prisma.orderedTest.findMany.mockResolvedValue([
        { status: 'COMPLETED' },
        { status: 'CANCELLED' },
      ]);
      prisma.specimen.findMany.mockResolvedValue([
        { status: 'ACCEPTED' },
        { status: 'EXPECTED' },
      ]);

      await expect(service.deriveOrderStatus('order-1')).resolves.toBe(
        'COMPLETED'
      );
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

    it('keeps the first receipt time when an order goes back to RECEIVED_BY_LAB', async () => {
      const firstReceipt = new Date('2026-10-01T08:00:00Z');
      prisma.order.findUniqueOrThrow
        .mockResolvedValueOnce({ status: 'PROCESSING' })
        .mockResolvedValueOnce({
          status: 'PROCESSING',
          caseId: 'case-1',
          receivedByLabAt: firstReceipt,
          processingStartedAt: firstReceipt,
        });
      // A test was added: nothing in progress, one READY
      prisma.orderedTest.findMany.mockResolvedValue([
        { status: 'COMPLETED' },
        { status: 'READY' },
      ]);
      prisma.specimen.findMany.mockResolvedValue([{ status: 'ACCEPTED' }]);

      await service.deriveAndPersist('order-1');

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'RECEIVED_BY_LAB' },
      });
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

  describe('outstandingSpecimens', () => {
    const tube = (
      orderId: string,
      status: string,
      tests: Array<{ status: string; blockReason?: string | null }>
    ) => ({
      orderId,
      status,
      orderedTests: tests.map((t) => ({
        orderedTest: { status: t.status, blockReason: t.blockReason ?? null },
      })),
    });

    beforeEach(() => {
      (prisma as Record<string, any>).specimen.findMany = jest.fn();
    });

    it('counts only tubes an unfinished, non-cancelled test still needs', async () => {
      prisma.specimen.findMany.mockResolvedValue([
        // Awaited for an added test → counts
        tube('o-1', 'EXPECTED', [{ status: 'PENDING' }]),
        // Awaited, but its only test was cancelled → doesn't
        tube('o-1', 'EXPECTED', [{ status: 'CANCELLED' }]),
        // Missing, its test blocked on it → counts
        tube('o-1', 'MISSING', [
          { status: 'BLOCKED', blockReason: 'MISSING_SPECIMEN' },
        ]),
        // Rejected and already replaced (test waiting on the new tube) → doesn't
        tube('o-2', 'REJECTED', [{ status: 'PENDING' }]),
        // Rejected, test still blocked on it → counts
        tube('o-2', 'REJECTED', [
          { status: 'BLOCKED', blockReason: 'REJECTED_SPECIMEN' },
        ]),
        // Rejected long ago, test completed on another tube → doesn't
        tube('o-3', 'REJECTED', [{ status: 'COMPLETED' }]),
      ]);

      const result = await service.outstandingSpecimens(['o-1', 'o-2', 'o-3']);

      expect(result.get('o-1')).toEqual({
        awaiting: 1,
        missing: 1,
        rejected: 0,
      });
      expect(result.get('o-2')).toEqual({
        awaiting: 0,
        missing: 0,
        rejected: 1,
      });
      expect(result.has('o-3')).toBe(false);
      expect(prisma.specimen.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            orderId: { in: ['o-1', 'o-2', 'o-3'] },
            status: { in: ['EXPECTED', 'MISSING', 'REJECTED'] },
          },
        })
      );
    });

    it('skips the query for no orders', async () => {
      await expect(service.outstandingSpecimens([])).resolves.toEqual(
        new Map()
      );
      expect(prisma.specimen.findMany).not.toHaveBeenCalled();
    });
  });
});
