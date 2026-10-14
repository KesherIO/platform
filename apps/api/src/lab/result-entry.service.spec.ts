import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ResultEntryService } from './result-entry.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';

describe('ResultEntryService — BLOCKED/CANCELLED guards', () => {
  let service: ResultEntryService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      orderedTest: { findFirst: jest.fn() },
      resultReportTest: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultEntryService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: {} },
      ],
    }).compile();

    service = module.get<ResultEntryService>(ResultEntryService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('getResultSession', () => {
    it('throws BadRequestException for BLOCKED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'MISSING_SPECIMEN',
        order: {
          case: {
            patientSpecies: 'CANINE',
            patientAge: 5,
            patientAgeUnit: 'YEARS',
          },
        },
      });

      await expect(service.getResultSession('test-1', 'lab-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException for CANCELLED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'CANCELLED',
        order: {
          case: {
            patientSpecies: 'CANINE',
            patientAge: 5,
            patientAgeUnit: 'YEARS',
          },
        },
      });

      await expect(service.getResultSession('test-1', 'lab-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws NotFoundException when test does not exist', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue(null);

      await expect(service.getResultSession('bad-id', 'lab-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('saveAnalytes', () => {
    it('throws BadRequestException for BLOCKED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'MISSING_SPECIMEN',
        order: {
          case: {
            patientSpecies: 'CANINE',
            patientAge: 5,
            patientAgeUnit: 'YEARS',
          },
        },
      });

      await expect(
        service.saveAnalytes('test-1', 'lab-1', [], 'user-1', 'User')
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for CANCELLED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'CANCELLED',
        order: {
          case: {
            patientSpecies: 'CANINE',
            patientAge: 5,
            patientAgeUnit: 'YEARS',
          },
        },
      });

      await expect(
        service.saveAnalytes('test-1', 'lab-1', [], 'user-1', 'User')
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a test in review with 409 (corrections must be requested first)', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'IN_REVIEW',
        catalogItemName: 'CBC',
        order: {
          case: {
            patientSpecies: 'DOG',
            patientAge: 5,
            patientAgeUnit: 'YEARS',
          },
        },
      });
      prisma.resultReportTest.findFirst.mockResolvedValue({
        status: 'IN_REVIEW',
      });

      await expect(
        service.saveAnalytes('test-1', 'lab-1', [], 'user-1', 'User')
      ).rejects.toThrow(ConflictException);
    });
  });
});

describe('ResultEntryService — manually picked template', () => {
  let service: ResultEntryService;
  let prisma: Record<string, any>;
  let templateVersionService: { resolveTemplateForTest: jest.Mock };

  const bovineProgesterone = {
    id: 'ot-1',
    catalogItemCode: 'PROG',
    templateDefinitionId: 'def-dog',
    catalogItemName: 'Progesterone',
    status: 'READY',
    order: {
      id: 'order-1',
      case: {
        patientSpecies: 'BOVINE',
        patientAge: null,
        patientAgeUnit: null,
      },
      resultReport: null,
    },
  };

  beforeEach(async () => {
    prisma = {
      orderedTest: {
        findFirst: jest.fn().mockResolvedValue(bovineProgesterone),
      },
    };
    templateVersionService = {
      resolveTemplateForTest: jest.fn().mockResolvedValue({
        id: 'def-dog',
        activeVersion: {
          title: 'Progesterona canina',
          defaultObservations: null,
          observationPhrases: null,
          sections: [],
          analytes: [],
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultEntryService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: templateVersionService },
      ],
    }).compile();

    service = module.get<ResultEntryService>(ResultEntryService);
  });

  it('opens the result session with the template picked at accessioning', async () => {
    const session = await service.getResultSession('ot-1', 'lab-1');

    expect(templateVersionService.resolveTemplateForTest).toHaveBeenCalledWith(
      bovineProgesterone,
      'lab-1',
      'BOVINE',
      null
    );
    expect(session.template.title).toBe('Progesterona canina');
  });

  it('still 404s when neither a pick nor a species match exists', async () => {
    templateVersionService.resolveTemplateForTest.mockResolvedValue(null);

    await expect(service.getResultSession('ot-1', 'lab-1')).rejects.toThrow(
      NotFoundException
    );
  });
});

describe('ResultEntryService — batch save validation', () => {
  let service: ResultEntryService;
  let prisma: Record<string, any>;
  let templateVersionService: { resolveTemplateForTest: jest.Mock };

  const version = {
    id: 'ver-1',
    definitionId: 'def-1',
    sections: [],
    analytes: [
      {
        id: 'a-glu',
        code: 'GLU',
        name: 'Glucosa',
        isHeader: false,
        formula: null,
        isRequired: true,
      },
    ],
  };

  const test = (
    id: string,
    overrides: { status?: string; orderId?: string; rtStatus?: string } = {}
  ) => ({
    id,
    catalogItemCode: 'CHEM',
    templateDefinitionId: null,
    catalogItemName: `Test ${id}`,
    status: overrides.status ?? 'READY',
    order: {
      id: overrides.orderId ?? 'order-1',
      caseId: 'case-1',
      tenantId: 'clinic-1',
      resultReport: overrides.rtStatus
        ? {
            id: 'report-1',
            tests: [{ orderedTestId: id, status: overrides.rtStatus }],
          }
        : null,
      case: { patientSpecies: 'DOG', patientAge: 3, patientAgeUnit: 'YEARS' },
    },
  });

  const entry = (testId: string, numericValue = 90, analyteId = 'a-glu') => ({
    testId,
    analytes: [{ templateAnalyteId: analyteId, numericValue }],
  });

  const run = (tests: ReturnType<typeof entry>[], submit = false) =>
    service.batchSaveAndSubmit('lab-1', tests, submit, 'user-1', 'User');

  beforeEach(async () => {
    prisma = {
      orderedTest: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    templateVersionService = {
      resolveTemplateForTest: jest
        .fn()
        .mockResolvedValue({ id: 'def-1', activeVersion: version }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultEntryService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: templateVersionService },
      ],
    }).compile();
    service = module.get<ResultEntryService>(ResultEntryService);
  });

  it('loads every test scoped to the lab', async () => {
    prisma.orderedTest.findMany.mockResolvedValue([test('t1')]);
    prisma.$transaction.mockResolvedValue({ results: [] });

    await run([entry('t1')]);

    expect(prisma.orderedTest.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['t1'] },
      order: { labTenantId: 'lab-1' },
    });
  });

  it('a test that is missing or from another lab fails the batch (not skipped)', async () => {
    prisma.orderedTest.findMany.mockResolvedValue([test('t1')]);

    await expect(run([entry('t1'), entry('t-other-lab')])).rejects.toThrow(
      NotFoundException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects tests from more than one order before writing', async () => {
    prisma.orderedTest.findMany.mockResolvedValue([
      test('t1', { orderId: 'order-1' }),
      test('t2', { orderId: 'order-2' }),
    ]);

    await expect(run([entry('t1'), entry('t2')])).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BATCH_SPANS_ORDERS' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['a released test (COMPLETED)', { status: 'COMPLETED' }],
    [
      'a released report test',
      { status: 'RESULTS_ENTERED', rtStatus: 'RELEASED' },
    ],
    ['a test in review', { status: 'IN_REVIEW', rtStatus: 'IN_REVIEW' }],
    ['a pending test', { status: 'PENDING' }],
    ['a blocked test', { status: 'BLOCKED' }],
    ['a cancelled test', { status: 'CANCELLED' }],
  ])('rejects %s with 409 before writing', async (_label, overrides) => {
    prisma.orderedTest.findMany.mockResolvedValue([
      test('t1'),
      test('t2', overrides),
    ]);

    await expect(run([entry('t1'), entry('t2')])).rejects.toThrow(
      ConflictException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects analytes that are not in the test template', async () => {
    prisma.orderedTest.findMany.mockResolvedValue([test('t1')]);

    await expect(run([entry('t1', 90, 'a-from-old-version')])).rejects.toThrow(
      BadRequestException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects negative values', async () => {
    prisma.orderedTest.findMany.mockResolvedValue([test('t1')]);

    await expect(run([entry('t1', -5)])).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a test without an active template', async () => {
    prisma.orderedTest.findMany.mockResolvedValue([test('t1')]);
    templateVersionService.resolveTemplateForTest.mockResolvedValue(null);

    await expect(run([entry('t1')])).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes everything in one interactive transaction', async () => {
    prisma.orderedTest.findMany.mockResolvedValue([
      test('t1'),
      test('t2', { status: 'RESULTS_ENTERED' }),
    ]);
    prisma.$transaction.mockResolvedValue({ results: [] });

    await run([entry('t1'), entry('t2')], true);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof prisma.$transaction.mock.calls[0][0]).toBe('function');
  });
});
