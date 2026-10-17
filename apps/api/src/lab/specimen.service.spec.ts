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

describe('SpecimenService — assignTemplateToBlockedTest', () => {
  let service: SpecimenService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      orderedTest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ot-1',
          catalogItemName: 'Progesterone',
          orderId: 'order-1',
        }),
        update: jest.fn().mockReturnValue('update-op'),
      },
      resultTemplateVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'ver-dog', definitionId: 'def-dog' }),
      },
      timelineEvent: { create: jest.fn().mockReturnValue('timeline-op') },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecimenService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: {} },
        {
          provide: OrderStatusService,
          useValue: { deriveAndPersist: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get<SpecimenService>(SpecimenService);
  });

  it('saves the picked template on the test so result entry can use it', async () => {
    const result = await service.assignTemplateToBlockedTest(
      'ot-1',
      'ver-dog',
      'lab-1',
      'user-1',
      'User'
    );

    expect(result).toEqual({
      resolved: true,
      test: { id: 'ot-1', status: 'READY' },
    });
    expect(prisma.orderedTest.update).toHaveBeenCalledWith({
      where: { id: 'ot-1' },
      data: expect.objectContaining({
        status: 'READY',
        templateDefinitionId: 'def-dog',
      }),
    });
  });

  it('only accepts templates from the platform or this lab', async () => {
    await service.assignTemplateToBlockedTest(
      'ot-1',
      'ver-dog',
      'lab-1',
      'user-1',
      'User'
    );

    expect(prisma.resultTemplateVersion.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'ver-dog',
        status: 'PUBLISHED',
        definition: {
          OR: [
            { scope: 'PLATFORM' },
            { scope: 'LABORATORY', labTenantId: 'lab-1' },
          ],
        },
      },
      select: { id: true, definitionId: true },
    });
  });

  it("throws NotFoundException for another lab's template", async () => {
    prisma.resultTemplateVersion.findFirst.mockResolvedValue(null);

    await expect(
      service.assignTemplateToBlockedTest(
        'ot-1',
        'ver-x',
        'lab-1',
        'user-1',
        'User'
      )
    ).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('SpecimenService — updateSpecimen (reject after the fact)', () => {
  let service: SpecimenService;
  let prisma: Record<string, any>;
  let orderStatusService: { deriveAndPersist: jest.Mock };

  beforeEach(async () => {
    orderStatusService = {
      deriveAndPersist: jest.fn().mockResolvedValue({ changed: true }),
    };
    prisma = {
      specimen: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sp-1',
          orderId: 'order-1',
          status: 'ACCEPTED',
          specimenType: 'SERUM',
          accessionNumber: 'SPEC-001',
        }),
        update: jest.fn().mockResolvedValue({ id: 'sp-1', status: 'REJECTED' }),
      },
      orderedTestSpecimen: { findMany: jest.fn().mockResolvedValue([]) },
      orderedTest: { update: jest.fn() },
      timelineEvent: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecimenService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: {} },
        { provide: OrderStatusService, useValue: orderStatusService },
      ],
    }).compile();
    service = module.get(SpecimenService);
  });

  it('blocks unstarted tests no other accepted tube serves, in one transaction', async () => {
    prisma.orderedTestSpecimen.findMany.mockResolvedValue([
      { orderedTest: { id: 'ot-only-this-tube', specimens: [] } },
      {
        orderedTest: {
          id: 'ot-also-on-another-tube',
          specimens: [{ specimenId: 'sp-2' }],
        },
      },
    ]);

    await service.updateSpecimen(
      'sp-1',
      'lab-1',
      { status: 'REJECTED', rejectionReason: 'Hemolyzed' },
      'user-1',
      'Ana'
    );

    expect(prisma.orderedTestSpecimen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          specimenId: 'sp-1',
          orderedTest: { status: { in: ['PENDING', 'READY'] } },
        },
      })
    );
    expect(prisma.orderedTest.update).toHaveBeenCalledTimes(1);
    expect(prisma.orderedTest.update).toHaveBeenCalledWith({
      where: { id: 'ot-only-this-tube' },
      data: expect.objectContaining({
        status: 'BLOCKED',
        blockReason: 'REJECTED_SPECIMEN',
      }),
    });
    expect(orderStatusService.deriveAndPersist).toHaveBeenCalledWith(
      'order-1',
      prisma
    );
  });

  it('notes and condition flags alone never block anything', async () => {
    await service.updateSpecimen(
      'sp-1',
      'lab-1',
      { notes: 'Slightly lipemic', isLipemic: true },
      'user-1',
      'Ana'
    );

    expect(prisma.orderedTestSpecimen.findMany).not.toHaveBeenCalled();
    expect(prisma.orderedTest.update).not.toHaveBeenCalled();
  });

  it('still requires a reason to reject', async () => {
    await expect(
      service.updateSpecimen(
        'sp-1',
        'lab-1',
        { status: 'REJECTED' },
        'user-1',
        'Ana'
      )
    ).rejects.toThrow(BadRequestException);
    expect(prisma.specimen.update).not.toHaveBeenCalled();
  });
});

describe('SpecimenService — accessionOrder (accessioning again)', () => {
  let service: SpecimenService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    const firstReceipt = new Date('2026-10-01T08:00:00Z');
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          status: 'RECEIVED_BY_LAB',
          case: {
            patientSpecies: 'CANINE',
            patientAge: null,
            patientAgeUnit: null,
          },
          // As the ACCESSIONABLE_TESTS filter returns them: none left waiting
          orderedTests: [],
          specimens: [
            {
              id: 'sp-1',
              specimenType: 'SERUM',
              containerType: 'SST_TUBE',
              tubeIndex: 1,
              receivedAt: firstReceipt,
              receivedById: 'first-receiver',
            },
          ],
        }),
      },
      specimen: {
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue({ id: 'sp-1' }),
        create: jest.fn(),
      },
      orderedTest: { updateMany: jest.fn() },
      timelineEvent: { createMany: jest.fn() },
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecimenService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: {} },
        {
          provide: OrderStatusService,
          useValue: {
            deriveAndPersist: jest
              .fn()
              .mockResolvedValue({ orderStatus: 'RECEIVED_BY_LAB' }),
          },
        },
      ],
    }).compile();
    service = module.get(SpecimenService);
  });

  it('only looks at tests still waiting for a sample or a template', async () => {
    await service.accessionOrder(
      'order-1',
      'lab-1',
      {
        specimens: [
          {
            specimenType: 'SERUM',
            containerType: 'SST_TUBE',
            tubeIndex: 1,
            accessionNumber: 'SPEC-2026-000001',
            accepted: true,
          },
        ],
      },
      'user-2',
      'Ben'
    );

    const query = prisma.order.findFirst.mock.calls[0][0];
    expect(query.select.orderedTests.where).toEqual({
      OR: [
        { status: 'PENDING' },
        {
          status: 'BLOCKED',
          blockReason: {
            in: [
              'MISSING_SPECIMEN',
              'REJECTED_SPECIMEN',
              'INSUFFICIENT_VOLUME',
              'REQUIRES_RECOLLECTION',
              'MISSING_RESULT_TEMPLATE',
            ],
          },
        },
      ],
    });
  });

  it('keeps the original receipt of a tube accessioned again', async () => {
    await service.accessionOrder(
      'order-1',
      'lab-1',
      {
        specimens: [
          {
            specimenType: 'SERUM',
            containerType: 'SST_TUBE',
            tubeIndex: 1,
            accessionNumber: 'SPEC-2026-000001',
            accepted: true,
          },
        ],
      },
      'user-2',
      'Ben'
    );

    expect(prisma.specimen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sp-1' },
        data: expect.objectContaining({
          receivedAt: new Date('2026-10-01T08:00:00Z'),
          receivedById: 'first-receiver',
        }),
      })
    );
  });
});
