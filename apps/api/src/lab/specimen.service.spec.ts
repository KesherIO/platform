import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SpecimenService } from './specimen.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { OrderStatusService } from './order-status.service';
import { NotificationService } from '../notifications/notification.service';
import { clinicOrderRecipients } from '../notifications/clinic-recipients';

jest.mock('../notifications/clinic-recipients', () => ({
  clinicOrderRecipients: jest.fn(),
}));

const notificationsMock = {
  publish: jest.fn().mockResolvedValue(1),
  deliverQueued: jest.fn(),
};

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
        { provide: NotificationService, useValue: notificationsMock },
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
        { provide: NotificationService, useValue: notificationsMock },
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
        { provide: NotificationService, useValue: notificationsMock },
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
        { provide: NotificationService, useValue: notificationsMock },
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

describe('SpecimenService — receiveSpecimen', () => {
  let service: SpecimenService;
  let prisma: Record<string, any>;
  let templates: { resolveTemplateForTest: jest.Mock };
  let orderStatusService: { deriveAndPersist: jest.Mock };

  const linked = (
    id: string,
    status: string,
    blockReason: string | null = null
  ) => ({
    orderedTest: {
      id,
      status,
      blockReason,
      receivedAt: null,
      catalogItemCode: 'T4',
      catalogItemName: `Test ${id}`,
      templateDefinitionId: null,
      catalogItem: {
        code: 'T4',
        labTestConfigurations: [
          {
            department: 'ENDOCRINOLOGY',
            defaultProcessingMethod: 'ANALYZER',
            defaultAnalyzerId: null,
          },
        ],
      },
    },
  });

  function tube(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sp-2',
      orderId: 'order-1',
      status: 'EXPECTED',
      specimenType: 'SERUM',
      accessionNumber: 'REQ-1-2',
      order: {
        status: 'PROCESSING',
        case: {
          patientSpecies: 'CANINE',
          patientAge: null,
          patientAgeUnit: null,
        },
      },
      orderedTests: [
        linked('ot-added', 'PENDING'),
        // Already running on another tube — must not move
        linked('ot-running', 'IN_PROGRESS'),
      ],
      ...overrides,
    };
  }

  beforeEach(async () => {
    templates = {
      resolveTemplateForTest: jest
        .fn()
        .mockResolvedValue({ id: 'def-1', activeVersionId: 'ver-1' }),
    };
    orderStatusService = {
      deriveAndPersist: jest
        .fn()
        .mockResolvedValue({ orderStatus: 'RECEIVED_BY_LAB' }),
    };
    prisma = {
      specimen: {
        findFirst: jest.fn().mockResolvedValue(tube()),
        update: jest.fn().mockImplementation(({ data }) => ({
          id: 'sp-2',
          status: data.status,
          accessionNumber: data.accessionNumber,
        })),
      },
      orderedTest: { update: jest.fn() },
      timelineEvent: { createMany: jest.fn() },
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecimenService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: templates },
        { provide: OrderStatusService, useValue: orderStatusService },
        { provide: NotificationService, useValue: notificationsMock },
      ],
    }).compile();
    service = module.get(SpecimenService);
  });

  it('accepting moves only the tests waiting for this tube to READY', async () => {
    const result = await service.receiveSpecimen(
      'sp-2',
      'lab-1',
      { accepted: true },
      'user-1',
      'Ana'
    );

    expect(prisma.specimen.update).toHaveBeenCalledWith({
      where: { id: 'sp-2' },
      data: expect.objectContaining({
        status: 'ACCEPTED',
        accessionNumber: 'REQ-1-2',
        receivedAt: expect.any(Date),
        receivedById: 'user-1',
      }),
    });
    expect(prisma.orderedTest.update).toHaveBeenCalledTimes(1);
    expect(prisma.orderedTest.update).toHaveBeenCalledWith({
      where: { id: 'ot-added' },
      data: expect.objectContaining({
        status: 'READY',
        department: 'ENDOCRINOLOGY',
      }),
    });
    expect(result.tests).toEqual([{ id: 'ot-added', status: 'READY' }]);
    expect(orderStatusService.deriveAndPersist).toHaveBeenCalledWith(
      'order-1',
      prisma
    );
  });

  it('blocks a waiting test when no result template matches', async () => {
    templates.resolveTemplateForTest.mockResolvedValue(null);

    await service.receiveSpecimen(
      'sp-2',
      'lab-1',
      { accepted: true },
      'u',
      'A'
    );

    expect(prisma.orderedTest.update).toHaveBeenCalledWith({
      where: { id: 'ot-added' },
      data: expect.objectContaining({
        status: 'BLOCKED',
        blockReason: 'MISSING_RESULT_TEMPLATE',
      }),
    });
  });

  it('rejecting blocks the waiting tests and records the reason', async () => {
    await service.receiveSpecimen(
      'sp-2',
      'lab-1',
      { accepted: false, rejectionReason: 'Coagulated', isHemolyzed: true },
      'u',
      'A'
    );

    expect(prisma.specimen.update).toHaveBeenCalledWith({
      where: { id: 'sp-2' },
      data: expect.objectContaining({
        status: 'REJECTED',
        rejectionReason: 'Coagulated',
        isHemolyzed: true,
      }),
    });
    expect(prisma.orderedTest.update).toHaveBeenCalledWith({
      where: { id: 'ot-added' },
      data: expect.objectContaining({
        status: 'BLOCKED',
        blockReason: 'REJECTED_SPECIMEN',
      }),
    });
    expect(templates.resolveTemplateForTest).not.toHaveBeenCalled();
  });

  it('a missing tube that turns up unblocks its tests', async () => {
    prisma.specimen.findFirst.mockResolvedValue(
      tube({
        status: 'MISSING',
        orderedTests: [linked('ot-1', 'BLOCKED', 'MISSING_SPECIMEN')],
      })
    );

    const result = await service.receiveSpecimen(
      'sp-2',
      'lab-1',
      { accepted: true },
      'u',
      'A'
    );
    expect(result.tests).toEqual([{ id: 'ot-1', status: 'READY' }]);
  });

  it('refuses a tube that is not awaited, and a rejection without a reason', async () => {
    prisma.specimen.findFirst.mockResolvedValueOnce(
      tube({ status: 'ACCEPTED' })
    );
    await expect(
      service.receiveSpecimen('sp-2', 'lab-1', { accepted: true }, 'u', 'A')
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.receiveSpecimen('sp-2', 'lab-1', { accepted: false }, 'u', 'A')
    ).rejects.toThrow(BadRequestException);
    expect(prisma.specimen.update).not.toHaveBeenCalled();
  });

  it("404s on another lab's tube", async () => {
    prisma.specimen.findFirst.mockResolvedValue(null);
    await expect(
      service.receiveSpecimen('sp-x', 'lab-1', { accepted: true }, 'u', 'A')
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SpecimenService — requestAnotherSample', () => {
  let service: SpecimenService;
  let prisma: Record<string, any>;

  const blockedTest = (overrides: Record<string, unknown> = {}) => ({
    id: 'ot-1',
    status: 'BLOCKED',
    blockReason: 'REJECTED_SPECIMEN',
    catalogItemName: 'T4',
    order: { id: 'order-1', status: 'PROCESSING', requisitionNumber: 'REQ-1' },
    catalogItem: {
      labTestConfigurations: [
        {
          specimenRequirements: [
            {
              specimenType: 'SERUM',
              containerType: 'SST_TUBE',
              isAlternativeWithinGroup: false,
            },
          ],
        },
      ],
    },
    ...overrides,
  });

  beforeEach(async () => {
    notificationsMock.publish.mockClear();
    notificationsMock.deliverQueued.mockClear();
    (clinicOrderRecipients as jest.Mock).mockReset().mockResolvedValue({
      tenantId: 'clinic-1',
      userIds: ['vet-1', 'owner-1'],
      requisitionNumber: 'REQ-1',
      caseId: 'case-1',
    });
    prisma = {
      orderedTest: {
        findFirst: jest.fn().mockResolvedValue(blockedTest()),
        update: jest.fn(),
      },
      specimen: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          // tubes of the order, then accession numbers already used
          .mockResolvedValueOnce([
            { specimenType: 'SERUM', containerType: 'SST_TUBE', tubeIndex: 1 },
          ])
          .mockResolvedValueOnce([{ accessionNumber: 'REQ-1-2' }]),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'sp-new', accessionNumber: 'REQ-1-3' }),
      },
      orderedTestSpecimen: { upsert: jest.fn() },
      timelineEvent: { create: jest.fn() },
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
        { provide: NotificationService, useValue: notificationsMock },
      ],
    }).compile();
    service = module.get(SpecimenService);
  });

  it('creates an awaited tube, puts the test back to waiting and tells the clinic', async () => {
    const result = await service.requestAnotherSample(
      'ot-1',
      'lab-1',
      { note: 'Vet will bring it tomorrow' },
      'user-1',
      'Ana'
    );

    expect(prisma.specimen.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        labTenantId: 'lab-1',
        accessionNumber: 'REQ-1-3',
        specimenType: 'SERUM',
        containerType: 'SST_TUBE',
        tubeIndex: 2,
        status: 'EXPECTED',
      },
      select: { id: true, accessionNumber: true },
    });
    expect(prisma.orderedTest.update).toHaveBeenCalledWith({
      where: { id: 'ot-1' },
      data: expect.objectContaining({ status: 'PENDING', blockReason: null }),
    });
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'SAMPLE_REQUESTED',
        metadata: expect.objectContaining({
          previousBlockReason: 'REJECTED_SPECIMEN',
          note: 'Vet will bring it tomorrow',
        }),
      }),
    });
    expect(clinicOrderRecipients).toHaveBeenCalledWith(prisma, 'order-1', {
      includeAdmins: true,
    });
    expect(notificationsMock.publish).toHaveBeenCalledWith(prisma, {
      type: 'ADDITIONAL_SAMPLE_REQUIRED',
      tenantId: 'clinic-1',
      eventKey: 'specimen:sp-new:requested',
      recipientUserIds: ['vet-1', 'owner-1'],
      orderId: 'order-1',
      params: {
        requisitionNumber: 'REQ-1',
        caseId: 'case-1',
        testNames: ['T4'],
      },
    });
    expect(notificationsMock.deliverQueued).toHaveBeenCalled();
    expect(result.specimen).toEqual({
      id: 'sp-new',
      accessionNumber: 'REQ-1-3',
    });
  });

  it('shares an already requested tube of the same kind', async () => {
    prisma.specimen.findFirst.mockResolvedValue({
      id: 'sp-awaited',
      accessionNumber: 'REQ-1-2',
    });

    await service.requestAnotherSample('ot-1', 'lab-1', {}, 'u', 'A');

    expect(prisma.specimen.create).not.toHaveBeenCalled();
    expect(prisma.orderedTestSpecimen.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { orderedTestId: 'ot-1', specimenId: 'sp-awaited' },
      })
    );
    // Same tube → same notification key: the clinic is told once
    expect(notificationsMock.publish.mock.calls[0][1].eventKey).toBe(
      'specimen:sp-awaited:requested'
    );
  });

  it('needs the sample spelled out when the test has no configured requirement', async () => {
    prisma.orderedTest.findFirst.mockResolvedValue(
      blockedTest({ catalogItem: { labTestConfigurations: [] } })
    );
    await expect(
      service.requestAnotherSample('ot-1', 'lab-1', {}, 'u', 'A')
    ).rejects.toThrow(BadRequestException);

    prisma.orderedTest.findFirst.mockResolvedValue(
      blockedTest({ catalogItem: { labTestConfigurations: [] } })
    );
    await service.requestAnotherSample(
      'ot-1',
      'lab-1',
      { specimenType: 'URINE', containerType: 'URINE_CUP' },
      'u',
      'A'
    );
    expect(prisma.specimen.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          specimenType: 'URINE',
          containerType: 'URINE_CUP',
          tubeIndex: 1,
        }),
      })
    );
  });

  it.each([
    ['a test not blocked', { status: 'READY', blockReason: null }],
    [
      'a test blocked for another reason',
      { blockReason: 'ANALYZER_UNAVAILABLE' },
    ],
    [
      'a cancelled order',
      {
        order: {
          id: 'order-1',
          status: 'CANCELLED',
          requisitionNumber: 'REQ-1',
        },
      },
    ],
  ])('refuses %s', async (_label, overrides) => {
    prisma.orderedTest.findFirst.mockResolvedValue(blockedTest(overrides));
    await expect(
      service.requestAnotherSample('ot-1', 'lab-1', {}, 'u', 'A')
    ).rejects.toThrow(BadRequestException);
    expect(notificationsMock.publish).not.toHaveBeenCalled();
  });
});

describe('SpecimenService — accessionOrder (samples not received yet)', () => {
  let service: SpecimenService;
  let prisma: Record<string, any>;
  let statuses: { deriveAndPersist: jest.Mock };

  const test = (
    id: string,
    container: string,
    status = 'PENDING',
    receivedAt: Date | null = null
  ) => ({
    id,
    catalogItemId: `cat-${id}`,
    catalogItemCode: id,
    catalogItemName: `Copro ${id}`,
    status,
    templateDefinitionId: null,
    receivedAt,
    catalogItem: {
      code: id,
      labTestConfigurations: [
        {
          department: null,
          defaultProcessingMethod: null,
          defaultAnalyzerId: null,
          specimenRequirements: [
            {
              specimenType: 'FECES',
              containerType: container,
              isAlternativeWithinGroup: false,
            },
          ],
        },
      ],
    },
  });

  const tube = (container: string, patch: Record<string, unknown> = {}) => ({
    specimenType: 'FECES',
    containerType: container,
    tubeIndex: 1,
    accessionNumber: `REQ-1-${container}`,
    accepted: false,
    ...patch,
  });

  async function build(
    orderedTests: ReturnType<typeof test>[],
    existingSpecimens: Record<string, unknown>[] = []
  ) {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          status: 'PENDING',
          case: {
            patientSpecies: 'CANINE',
            patientAge: null,
            patientAgeUnit: null,
          },
          orderedTests,
          specimens: existingSpecimens,
        }),
      },
      specimen: {
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockImplementation(({ where }) => ({ id: where.id })),
        create: jest
          .fn()
          .mockImplementation(({ data }) => ({
            id: `new-${data.containerType}`,
          })),
      },
      orderedTest: { update: jest.fn(), updateMany: jest.fn() },
      orderedTestSpecimen: { upsert: jest.fn() },
      timelineEvent: { createMany: jest.fn() },
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
    statuses = {
      deriveAndPersist: jest
        .fn()
        .mockResolvedValue({ orderStatus: 'RECEIVED_BY_LAB' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecimenService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: TemplateVersionService,
          useValue: {
            resolveTemplateForTest: jest
              .fn()
              .mockResolvedValue({ id: 'tpl', activeVersionId: 'v1' }),
          },
        },
        { provide: NotificationService, useValue: notificationsMock },
        { provide: OrderStatusService, useValue: statuses },
      ],
    }).compile();
    service = module.get(SpecimenService);
  }

  const accession = (specimens: Record<string, unknown>[]) =>
    service.accessionOrder(
      'order-1',
      'lab-1',
      { specimens } as never,
      'user-1',
      'Ana'
    );
  const events = () =>
    prisma.timelineEvent.createMany.mock.calls[0][0].data as Array<{
      eventType: string;
      description: string;
      metadata: Record<string, unknown>;
    }>;

  it('receives copro 1 and leaves copro 2 waiting: expected tube, test stays pending, nothing rejected', async () => {
    await build([test('c1', 'FRASCO_1'), test('c2', 'FRASCO_2')]);

    await accession([
      tube('FRASCO_1', { accepted: true }),
      tube('FRASCO_2', { awaiting: true, accepted: true /* ignored */ }),
    ]);

    // the awaited tube is EXPECTED with no receipt and no conditions
    const created = prisma.specimen.create.mock.calls.map(
      (c: any) => c[0].data
    );
    expect(
      created.find((d: any) => d.containerType === 'FRASCO_2')
    ).toMatchObject({
      status: 'EXPECTED',
      receivedAt: null,
      receivedById: null,
      rejectionReason: null,
      isInsufficient: false,
    });
    expect(
      created.find((d: any) => d.containerType === 'FRASCO_1')
    ).toMatchObject({
      status: 'ACCEPTED',
      receivedById: 'user-1',
    });

    // copro 1 is ready; copro 2 is linked to its awaited tube and not touched
    const updates = prisma.orderedTest.update.mock.calls.map((c: any) => c[0]);
    expect(updates).toEqual([
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ status: 'READY' }),
      }),
    ]);
    expect(prisma.orderedTestSpecimen.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { orderedTestId: 'c2', specimenId: 'new-FRASCO_2' },
      })
    );

    // not stamped as received, and no rejection event
    expect(prisma.orderedTest.updateMany.mock.calls[0][0].where).toEqual({
      orderId: 'order-1',
      receivedAt: null,
      id: { notIn: ['c2'] },
    });
    expect(events().map((e) => e.eventType)).not.toContain('SAMPLE_REJECTED');
    const overall = events().find((e) => e.eventType === 'SAMPLE_ACCESSIONED');
    expect(overall?.description).toContain('1 not received yet');
    expect(overall?.metadata).toMatchObject({
      accepted: 1,
      rejected: 0,
      awaiting: 1,
    });
    // and nobody is notified
    expect(notificationsMock.publish).not.toHaveBeenCalled();
  });

  it('refuses an accession in which nothing is received', async () => {
    await build([test('c1', 'FRASCO_1')]);
    await expect(
      accession([tube('FRASCO_1', { awaiting: true })])
    ).rejects.toThrow(/at least one sample/i);
    expect(prisma.specimen.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a tube already received cannot be marked as not received', async () => {
    await build(
      [test('c1', 'FRASCO_1')],
      [
        {
          id: 'sp-1',
          specimenType: 'FECES',
          containerType: 'FRASCO_1',
          tubeIndex: 1,
          receivedAt: new Date('2026-10-01T08:00:00Z'),
          receivedById: 'someone',
        },
        {
          id: 'sp-2',
          specimenType: 'FECES',
          containerType: 'FRASCO_2',
          tubeIndex: 1,
          receivedAt: null,
          receivedById: null,
        },
      ]
    );
    await expect(
      accession([
        tube('FRASCO_1', { awaiting: true }),
        tube('FRASCO_2', { accepted: true }),
      ])
    ).rejects.toThrow(/already received/i);
  });

  it('a test blocked by an earlier rejection goes back to pending when its tube is awaited again', async () => {
    await build(
      [test('c2', 'FRASCO_2', 'BLOCKED'), test('c1', 'FRASCO_1')],
      [
        {
          id: 'sp-2',
          specimenType: 'FECES',
          containerType: 'FRASCO_2',
          tubeIndex: 1,
          receivedAt: null,
          receivedById: null,
        },
      ]
    );
    await accession([
      tube('FRASCO_1', { accepted: true }),
      tube('FRASCO_2', { awaiting: true }),
    ]);
    expect(prisma.orderedTest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c2' },
        data: expect.objectContaining({ status: 'PENDING', blockReason: null }),
      })
    );
    // an existing EXPECTED tube is updated, not duplicated
    expect(prisma.specimen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sp-2' },
        data: expect.objectContaining({ status: 'EXPECTED', receivedAt: null }),
      })
    );
  });

  it('waiting for another tube of its kind beats blocking on a rejected one', async () => {
    await build([test('c1', 'FRASCO_1'), test('c2', 'FRASCO_1')]);
    await accession([
      tube('FRASCO_1', {
        tubeIndex: 1,
        accepted: false,
        rejectionReason: 'leaked',
      }),
      tube('FRASCO_1', {
        tubeIndex: 2,
        awaiting: true,
        accessionNumber: 'REQ-1-2',
      }),
      tube('FRASCO_2', { accepted: true, accessionNumber: 'REQ-1-3' }),
    ]);
    const blocked = prisma.orderedTest.update.mock.calls.filter(
      (c: any) => c[0].data.status === 'BLOCKED'
    );
    expect(blocked).toHaveLength(0);
  });
});
