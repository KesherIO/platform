import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SpecimenService } from './specimen.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { OrderStatusService } from './order-status.service';

function makeTx() {
  return {
    specimen: { update: jest.fn().mockResolvedValue({}) },
    orderedTest: { update: jest.fn().mockResolvedValue({}) },
    orderedTestSpecimen: { findMany: jest.fn().mockResolvedValue([]) },
    timelineEvent: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe('SpecimenService — reverseMissing', () => {
  let service: SpecimenService;
  let prisma: Record<string, any>;
  let orderStatusService: { deriveAndPersist: jest.Mock };

  beforeEach(async () => {
    orderStatusService = {
      deriveAndPersist: jest.fn().mockResolvedValue({ changed: false }),
    };

    prisma = {
      specimen: {
        findFirst: jest.fn(),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'sp-1', status: 'EXPECTED' }),
      },
      orderedTest: { update: jest.fn() },
      orderedTestSpecimen: { findMany: jest.fn() },
      timelineEvent: { create: jest.fn() },
      $transaction: jest.fn(
        async (cb: (tx: ReturnType<typeof makeTx>) => Promise<void>) => {
          const tx = makeTx();
          prisma._lastTx = tx;
          await cb(tx as any);
        }
      ),
      _lastTx: null as ReturnType<typeof makeTx> | null,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecimenService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: {} },
        { provide: OrderStatusService, useValue: orderStatusService },
      ],
    }).compile();

    service = module.get<SpecimenService>(SpecimenService);
  });

  const baseSpecimen = {
    id: 'sp-1',
    orderId: 'order-1',
    status: 'MISSING',
    accessionNumber: 'SPEC-001',
    specimenType: 'EDTA_BLOOD',
  };

  function setupSpecimenFound() {
    prisma.specimen.findFirst.mockResolvedValue({ ...baseSpecimen });
  }

  it('throws if specimen is not MISSING', async () => {
    prisma.specimen.findFirst.mockResolvedValue({
      ...baseSpecimen,
      status: 'ACCEPTED',
    });

    await expect(
      service.reverseMissing(
        'order-1',
        'sp-1',
        'lab-1',
        { confirm: true },
        'user-1',
        'User'
      )
    ).rejects.toThrow(BadRequestException);
  });

  it('unblocks single-specimen test to PENDING when no ResultReportTest', async () => {
    setupSpecimenFound();
    prisma._lastTx = null;

    const linkedTest = {
      orderedTest: {
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'MISSING_SPECIMEN',
        blockReasonDetail: 'Specimen SPEC-001 (EDTA_BLOOD) marked missing',
        specimens: [
          {
            specimen: {
              id: 'sp-1',
              status: 'MISSING',
              accessionNumber: 'SPEC-001',
            },
          },
        ],
        reportTests: [],
      },
    };

    prisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = makeTx();
      tx.orderedTestSpecimen.findMany.mockResolvedValue([linkedTest]);
      prisma._lastTx = tx;
      await cb(tx);
    });

    await service.reverseMissing(
      'order-1',
      'sp-1',
      'lab-1',
      { confirm: true },
      'user-1',
      'User'
    );

    const tx = prisma._lastTx!;
    expect(tx.orderedTest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-1' },
        data: expect.objectContaining({ status: 'PENDING', blockReason: null }),
      })
    );
  });

  it('unblocks to READY when test has a ResultReportTest', async () => {
    setupSpecimenFound();

    const linkedTest = {
      orderedTest: {
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'MISSING_SPECIMEN',
        blockReasonDetail: 'Specimen SPEC-001 (EDTA_BLOOD) marked missing',
        specimens: [
          {
            specimen: {
              id: 'sp-1',
              status: 'MISSING',
              accessionNumber: 'SPEC-001',
            },
          },
        ],
        reportTests: [{ id: 'rrt-1' }],
      },
    };

    prisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = makeTx();
      tx.orderedTestSpecimen.findMany.mockResolvedValue([linkedTest]);
      prisma._lastTx = tx;
      await cb(tx);
    });

    await service.reverseMissing(
      'order-1',
      'sp-1',
      'lab-1',
      { confirm: true },
      'user-1',
      'User'
    );

    const tx = prisma._lastTx!;
    expect(tx.orderedTest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-1' },
        data: expect.objectContaining({ status: 'READY', blockReason: null }),
      })
    );
  });

  it('keeps test BLOCKED when another specimen is still MISSING', async () => {
    setupSpecimenFound();

    const linkedTest = {
      orderedTest: {
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'MISSING_SPECIMEN',
        blockReasonDetail: 'Specimen SPEC-001 (EDTA_BLOOD) marked missing',
        specimens: [
          {
            specimen: {
              id: 'sp-1',
              status: 'MISSING',
              accessionNumber: 'SPEC-001',
            },
          },
          {
            specimen: {
              id: 'sp-2',
              status: 'MISSING',
              accessionNumber: 'SPEC-002',
            },
          },
        ],
        reportTests: [],
      },
    };

    prisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = makeTx();
      tx.orderedTestSpecimen.findMany.mockResolvedValue([linkedTest]);
      prisma._lastTx = tx;
      await cb(tx);
    });

    await service.reverseMissing(
      'order-1',
      'sp-1',
      'lab-1',
      { confirm: true },
      'user-1',
      'User'
    );

    const tx = prisma._lastTx!;
    const updateCalls = tx.orderedTest.update.mock.calls;
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][0].data).toEqual(
      expect.objectContaining({
        blockReasonDetail: expect.stringContaining('SPEC-002'),
      })
    );
    expect(updateCalls[0][0].data.status).toBeUndefined();
  });

  it('does not unblock test blocked by a different specimen', async () => {
    setupSpecimenFound();

    const linkedTest = {
      orderedTest: {
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'MISSING_SPECIMEN',
        blockReasonDetail: 'Specimen SPEC-999 (SERUM) marked missing',
        specimens: [
          {
            specimen: {
              id: 'sp-1',
              status: 'MISSING',
              accessionNumber: 'SPEC-001',
            },
          },
          {
            specimen: {
              id: 'sp-999',
              status: 'MISSING',
              accessionNumber: 'SPEC-999',
            },
          },
        ],
        reportTests: [],
      },
    };

    prisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = makeTx();
      tx.orderedTestSpecimen.findMany.mockResolvedValue([linkedTest]);
      prisma._lastTx = tx;
      await cb(tx);
    });

    await service.reverseMissing(
      'order-1',
      'sp-1',
      'lab-1',
      { confirm: true },
      'user-1',
      'User'
    );

    const tx = prisma._lastTx!;
    expect(tx.orderedTest.update).not.toHaveBeenCalled();
  });

  it('does not touch test blocked for REJECTED_SPECIMEN', async () => {
    setupSpecimenFound();

    const linkedTest = {
      orderedTest: {
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'REJECTED_SPECIMEN',
        blockReasonDetail: 'Specimen SPEC-001 rejected',
        specimens: [
          {
            specimen: {
              id: 'sp-1',
              status: 'MISSING',
              accessionNumber: 'SPEC-001',
            },
          },
        ],
        reportTests: [],
      },
    };

    prisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = makeTx();
      tx.orderedTestSpecimen.findMany.mockResolvedValue([linkedTest]);
      prisma._lastTx = tx;
      await cb(tx);
    });

    await service.reverseMissing(
      'order-1',
      'sp-1',
      'lab-1',
      { confirm: true },
      'user-1',
      'User'
    );

    const tx = prisma._lastTx!;
    expect(tx.orderedTest.update).not.toHaveBeenCalled();
  });

  it('calls deriveAndPersist after the transaction', async () => {
    setupSpecimenFound();

    prisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = makeTx();
      tx.orderedTestSpecimen.findMany.mockResolvedValue([]);
      prisma._lastTx = tx;
      await cb(tx);
    });

    await service.reverseMissing(
      'order-1',
      'sp-1',
      'lab-1',
      { confirm: true },
      'user-1',
      'User'
    );

    expect(orderStatusService.deriveAndPersist).toHaveBeenCalledWith('order-1');
  });
});
