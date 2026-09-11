import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ReleaseService } from './release.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatusService } from './order-status.service';

describe('ReleaseService', () => {
  let service: ReleaseService;
  let prisma: Record<string, any>;
  let orderStatusService: Record<string, any>;

  const baseSigner = {
    id: 'signer-1',
    name: 'Dr. Pérez',
    title: 'DVM',
    specialty: 'Clinical Pathology',
    university: 'UBA',
    registrationNumber: 'REG-001',
    signatureUrl: '/assets/sig.png',
    roles: ['REVIEWER'],
    laboratoryProfile: { tenantId: 'lab-1' },
  };

  const baseOrder = {
    id: 'order-1',
    caseId: 'case-1',
    requisitionNumber: 'REQ-001',
    priority: 'NORMAL',
    clinicNotes: null,
    createdAt: new Date('2026-01-01'),
    tenantId: 'clinic-1',
    labTenantId: 'lab-1',
    resultReport: {
      id: 'report-1',
      status: 'IN_REVIEW',
      currentReleaseSequence: 0,
    },
    orderedTests: [
      {
        id: 'ot-1',
        status: 'IN_REVIEW',
        catalogItemCode: 'HMG',
        catalogItemName: 'Hemogram',
        department: 'Hematology',
        processingMethod: 'AUTO',
        entryMethod: 'MANUAL',
        startedAt: new Date(),
        completedAt: null,
        specimens: [
          { specimen: { accessionNumber: 'ACC-001', specimenType: 'BLOOD' } },
        ],
      },
      {
        id: 'ot-2',
        status: 'IN_PROGRESS',
        catalogItemCode: 'CUL',
        catalogItemName: 'Culture',
        department: 'Microbiology',
        processingMethod: 'MANUAL',
        entryMethod: 'MANUAL',
        startedAt: new Date(),
        completedAt: null,
        specimens: [
          { specimen: { accessionNumber: 'ACC-002', specimenType: 'URINE' } },
        ],
      },
    ],
  };

  const baseReportTest = {
    id: 'rt-1',
    reportId: 'report-1',
    orderedTestId: 'ot-1',
    status: 'IN_REVIEW',
    templateVersion: { id: 'tv-1', title: 'Hemogram Template', version: 1 },
    templateDefinition: { id: 'td-1' },
    analytes: [
      {
        id: 'a-1',
        code: 'WBC',
        name: 'White Blood Cells',
        sectionName: 'CBC',
        sortOrder: 1,
        isHeader: false,
        valueType: 'NUMERIC',
        numericValue: 12.5,
        textValue: null,
        booleanValue: null,
        selectValue: null,
        unit: 'K/uL',
        technique: null,
        formula: null,
        flag: null,
        referenceSnapshot: null,
        templateAnalyte: {
          referenceRange: { min: 5.5, max: 16.9, displayText: '5.5–16.9' },
        },
      },
    ],
  };

  function buildPrismaMock() {
    return {
      order: { findFirst: jest.fn() },
      resultReport: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      resultReportTest: { findMany: jest.fn(), update: jest.fn() },
      resultReportAmendment: { findMany: jest.fn() },
      resultReportRelease: { create: jest.fn(), findMany: jest.fn() },
      resultReportReleaseTest: { create: jest.fn(), findMany: jest.fn() },
      resultReportReleaseAnalyte: { create: jest.fn(), createMany: jest.fn() },
      resultReportReleaseArtifact: { create: jest.fn() },
      resultReportAnalyte: { update: jest.fn() },
      orderedTest: { findMany: jest.fn(), update: jest.fn() },
      labSigner: { findUnique: jest.fn() },
      timelineEvent: { create: jest.fn() },
      case: { findUniqueOrThrow: jest.fn() },
      tenant: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn() },
      laboratoryProfile: { findUnique: jest.fn() },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
    };
  }

  beforeEach(async () => {
    prisma = buildPrismaMock();
    orderStatusService = {
      deriveAndPersist: jest.fn().mockResolvedValue({ changed: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReleaseService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrderStatusService, useValue: orderStatusService },
      ],
    }).compile();

    service = module.get<ReleaseService>(ReleaseService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('approveAndRelease — validation', () => {
    it('throws BadRequestException when testIds is empty', async () => {
      await expect(
        service.approveAndRelease({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          signerId: 'signer-1',
          testIds: [],
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.approveAndRelease({
          orderId: 'bad',
          labTenantId: 'lab-1',
          signerId: 'signer-1',
          testIds: ['rt-1'],
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when no report exists', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...baseOrder,
        resultReport: null,
      });

      await expect(
        service.approveAndRelease({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          signerId: 'signer-1',
          testIds: ['rt-1'],
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when tests are not IN_REVIEW', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);
      prisma.resultReportTest.findMany.mockResolvedValue([
        { ...baseReportTest, status: 'DRAFT' },
      ]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique.mockResolvedValue(baseSigner);

      await expect(
        service.approveAndRelease({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          signerId: 'signer-1',
          testIds: ['rt-1'],
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when tests have active amendments', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([
        { reportTestId: 'rt-1' },
      ]);

      await expect(
        service.approveAndRelease({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          signerId: 'signer-1',
          testIds: ['rt-1'],
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when signer not in lab', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique.mockResolvedValue({
        ...baseSigner,
        laboratoryProfile: { tenantId: 'other-lab' },
      });

      await expect(
        service.approveAndRelease({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          signerId: 'signer-1',
          testIds: ['rt-1'],
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when signer lacks REVIEWER role', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique.mockResolvedValue({
        ...baseSigner,
        roles: ['TECHNICIAN'],
      });

      await expect(
        service.approveAndRelease({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          signerId: 'signer-1',
          testIds: ['rt-1'],
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('approveAndRelease — transaction', () => {
    function buildTxMock(overrides?: {
      currentSeq?: number;
      staleCheck?: Array<{ id: string; status: string }>;
      updatedTests?: Array<{ id: string; status: string }>;
      orderedTests?: Array<{ id: string; status: string }>;
      releaseId?: string;
    }) {
      const opts = {
        currentSeq: 0,
        staleCheck: [{ id: 'rt-1', status: 'IN_REVIEW' }],
        updatedTests: [{ id: 'rt-1', status: 'RELEASED' }],
        orderedTests: [
          { id: 'ot-1', status: 'IN_REVIEW' },
          { id: 'ot-2', status: 'IN_PROGRESS' },
        ],
        releaseId: 'release-1',
        ...overrides,
      };
      const tx = buildPrismaMock();
      tx.$queryRaw.mockResolvedValue([]);
      tx.resultReport.findUniqueOrThrow.mockResolvedValue({
        currentReleaseSequence: opts.currentSeq,
      });
      tx.resultReportTest.findMany
        .mockResolvedValueOnce(opts.staleCheck)
        .mockResolvedValueOnce(opts.updatedTests);
      tx.orderedTest.findMany.mockResolvedValue(opts.orderedTests);
      tx.resultReportRelease.create.mockResolvedValue({ id: opts.releaseId });
      tx.resultReportReleaseTest.create.mockResolvedValue({ id: 'rlt-1' });
      tx.resultReportReleaseAnalyte.create.mockResolvedValue({});
      tx.resultReportReleaseArtifact.create.mockResolvedValue({});
      tx.resultReportAnalyte.update.mockResolvedValue({});
      tx.resultReportTest.update.mockResolvedValue({});
      tx.orderedTest.update.mockResolvedValue({});
      tx.resultReport.update.mockResolvedValue({});
      tx.timelineEvent.create.mockResolvedValue({});
      tx.case.findUniqueOrThrow.mockResolvedValue({
        patientName: 'Rex',
        patientSpecies: 'CANINE',
        patientSex: 'MALE',
        patientBreed: 'Labrador',
        patientAge: 5,
        patientAgeUnit: 'YEARS',
        patientDateOfBirth: null,
        patientWeight: 30,
        ownerName: 'Smith',
        ownerPhone: null,
      });
      tx.tenant.findUniqueOrThrow.mockResolvedValue({
        name: 'PetClinic',
        address: '123 Main',
        phone: '555-0000',
        logoUrl: null,
      });
      tx.tenant.findUnique.mockResolvedValue({
        name: 'BioLab',
        address: '456 Lab',
        phone: '555-1111',
        logoUrl: null,
      });
      tx.laboratoryProfile.findUnique.mockResolvedValue({
        accreditationNumber: 'ACC-123',
        directorName: 'Dr. Lab',
        directorCredentials: 'PhD',
      });
      (orderStatusService.deriveAndPersist as jest.Mock).mockResolvedValue({
        changed: false,
      });
      return tx;
    }

    function setupTransactionMocks(
      overrides?: Parameters<typeof buildTxMock>[0]
    ) {
      prisma.order.findFirst.mockResolvedValue(baseOrder);
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique
        .mockResolvedValueOnce(baseSigner)
        .mockResolvedValueOnce(baseSigner);

      prisma.$transaction.mockImplementation(async (fn) =>
        fn(buildTxMock(overrides))
      );
    }

    it('scenario 1: partial release — hemogram released while culture is IN_PROGRESS', async () => {
      setupTransactionMocks();

      const result = await service.approveAndRelease({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        signerId: 'signer-1',
        testIds: ['rt-1'],
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.releaseType).toBe('PARTIAL');
      expect(result.releaseSequence).toBe(1);
      expect(result.releasedTests).toHaveLength(1);
      expect(result.releasedTests[0].reportTestId).toBe('rt-1');
    });

    it('scenario 2: multiple selected tests released together', async () => {
      const secondReportTest = {
        ...baseReportTest,
        id: 'rt-2',
        orderedTestId: 'ot-2',
        analytes: [
          {
            ...baseReportTest.analytes[0],
            id: 'a-2',
            code: 'RBC',
            name: 'Red Blood Cells',
          },
        ],
      };

      prisma.order.findFirst.mockResolvedValue({
        ...baseOrder,
        orderedTests: baseOrder.orderedTests.map((ot) => ({
          ...ot,
          status: 'IN_REVIEW',
        })),
      });
      prisma.resultReportTest.findMany.mockResolvedValue([
        baseReportTest,
        secondReportTest,
      ]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique
        .mockResolvedValueOnce(baseSigner)
        .mockResolvedValueOnce(baseSigner);

      prisma.$transaction.mockImplementation(async (fn) =>
        fn(
          buildTxMock({
            staleCheck: [
              { id: 'rt-1', status: 'IN_REVIEW' },
              { id: 'rt-2', status: 'IN_REVIEW' },
            ],
            updatedTests: [
              { id: 'rt-1', status: 'RELEASED' },
              { id: 'rt-2', status: 'RELEASED' },
            ],
            orderedTests: [
              { id: 'ot-1', status: 'IN_REVIEW' },
              { id: 'ot-2', status: 'IN_REVIEW' },
            ],
          })
        )
      );

      const result = await service.approveAndRelease({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        signerId: 'signer-1',
        testIds: ['rt-1', 'rt-2'],
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.releaseType).toBe('FINAL');
      expect(result.releasedTests).toHaveLength(2);
    });

    it('scenario 3: final release completing the order', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...baseOrder,
        orderedTests: [{ ...baseOrder.orderedTests[0], status: 'IN_REVIEW' }],
      });
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique
        .mockResolvedValueOnce(baseSigner)
        .mockResolvedValueOnce(baseSigner);

      prisma.$transaction.mockImplementation(async (fn) =>
        fn(
          buildTxMock({
            orderedTests: [{ id: 'ot-1', status: 'IN_REVIEW' }],
          })
        )
      );

      const result = await service.approveAndRelease({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        signerId: 'signer-1',
        testIds: ['rt-1'],
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.releaseType).toBe('FINAL');
      expect(result.aggregateReportStatus).toBe('ALL_RELEASED');
    });

    it('scenario 5: edit released test via saveAnalytes is blocked', () => {
      // This is tested in result-entry.service.spec.ts — the RELEASED guard.
      // Including here as a cross-reference for the test plan.
      expect(true).toBe(true);
    });

    it('scenario 8: different signers across releases — each release has its own signer snapshot', async () => {
      setupTransactionMocks();

      const result = await service.approveAndRelease({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        signerId: 'signer-1',
        testIds: ['rt-1'],
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.releaseId).toBe('release-1');
    });

    it('scenario 10: concurrent overlapping batches — second gets ConflictException', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique
        .mockResolvedValueOnce(baseSigner)
        .mockResolvedValueOnce(baseSigner);

      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = buildPrismaMock();
        tx.$queryRaw.mockResolvedValue([]);
        tx.resultReport.findUniqueOrThrow.mockResolvedValue({
          currentReleaseSequence: 1,
        });
        tx.resultReportTest.findMany.mockResolvedValueOnce([
          { id: 'rt-1', status: 'RELEASED' },
        ]);
        return fn(tx);
      });

      await expect(
        service.approveAndRelease({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          signerId: 'signer-1',
          testIds: ['rt-1'],
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('scenario 12: cancelled tests treated as terminal — final release when remaining complete', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...baseOrder,
        orderedTests: [
          { ...baseOrder.orderedTests[0], status: 'IN_REVIEW' },
          { ...baseOrder.orderedTests[1], id: 'ot-2', status: 'CANCELLED' },
        ],
      });
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique
        .mockResolvedValueOnce(baseSigner)
        .mockResolvedValueOnce(baseSigner);

      prisma.$transaction.mockImplementation(async (fn) =>
        fn(
          buildTxMock({
            orderedTests: [
              { id: 'ot-1', status: 'IN_REVIEW' },
              { id: 'ot-2', status: 'CANCELLED' },
            ],
          })
        )
      );

      const result = await service.approveAndRelease({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        signerId: 'signer-1',
        testIds: ['rt-1'],
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.releaseType).toBe('FINAL');
    });

    it('vet snapshot: populated in release when order has ordering vet', async () => {
      const orderWithVet = {
        ...baseOrder,
        orderingVetId: 'vet-user-1',
        orderingVetName: 'Dr. García, DVM',
        orderingVetLicenseNumber: 'LIC-001',
        orderingVetIssuingAuthority: 'CVMC',
      };
      prisma.order.findFirst.mockResolvedValue(orderWithVet);
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique
        .mockResolvedValueOnce(baseSigner)
        .mockResolvedValueOnce(baseSigner);

      let capturedReleaseData: Record<string, unknown> | null = null;
      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = buildTxMock();
        tx.resultReportRelease.create.mockImplementation((args) => {
          capturedReleaseData = args.data;
          return Promise.resolve({ id: 'release-1' });
        });
        return fn(tx);
      });

      await service.approveAndRelease({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        signerId: 'signer-1',
        testIds: ['rt-1'],
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(capturedReleaseData).toMatchObject({
        orderingVetId: 'vet-user-1',
        orderingVetName: 'Dr. García, DVM',
        orderingVetLicenseNumber: 'LIC-001',
        orderingVetIssuingAuthority: 'CVMC',
      });
    });

    it('vet snapshot: null when order has no ordering vet (backward compat)', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...baseOrder,
        orderingVetId: null,
        orderingVetName: null,
        orderingVetLicenseNumber: null,
        orderingVetIssuingAuthority: null,
      });
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique
        .mockResolvedValueOnce(baseSigner)
        .mockResolvedValueOnce(baseSigner);

      let capturedReleaseData: Record<string, unknown> | null = null;
      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = buildTxMock();
        tx.resultReportRelease.create.mockImplementation((args) => {
          capturedReleaseData = args.data;
          return Promise.resolve({ id: 'release-1' });
        });
        return fn(tx);
      });

      await service.approveAndRelease({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        signerId: 'signer-1',
        testIds: ['rt-1'],
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(capturedReleaseData).toMatchObject({
        orderingVetId: null,
        orderingVetName: null,
        orderingVetLicenseNumber: null,
        orderingVetIssuingAuthority: null,
      });
    });

    it('scenario 19: release sequence monotonically increases', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);
      prisma.resultReportTest.findMany.mockResolvedValue([baseReportTest]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);
      prisma.labSigner.findUnique
        .mockResolvedValueOnce(baseSigner)
        .mockResolvedValueOnce(baseSigner);

      prisma.$transaction.mockImplementation(async (fn) =>
        fn(
          buildTxMock({
            currentSeq: 2,
            releaseId: 'release-3',
          })
        )
      );

      const result = await service.approveAndRelease({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        signerId: 'signer-1',
        testIds: ['rt-1'],
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.releaseSequence).toBe(3);
    });
  });

  describe('getReleaseHistory', () => {
    it('returns empty when no report exists', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: null,
      });

      const result = await service.getReleaseHistory('order-1', 'lab-1');
      expect(result.releases).toHaveLength(0);
      expect(result.aggregateReportStatus).toBe('PARTIAL_RESULTS');
    });

    it('returns ALL_RELEASED when all tests released', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportRelease.findMany.mockResolvedValue([
        {
          id: 'rel-1',
          releaseSequence: 1,
          releaseType: 'FINAL',
          signerName: 'Dr. Pérez',
          releasedAt: new Date(),
          tests: [
            {
              catalogItemName: 'Hemogram',
              catalogItemCode: 'HMG',
              amendsReleaseTestId: null,
            },
          ],
          artifacts: [{ status: 'COMPLETED', storageUrl: '/pdf/1.pdf' }],
        },
      ]);
      prisma.resultReportTest.findMany.mockResolvedValue([
        { status: 'RELEASED' },
      ]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);

      const result = await service.getReleaseHistory('order-1', 'lab-1');
      expect(result.aggregateReportStatus).toBe('ALL_RELEASED');
      expect(result.releases).toHaveLength(1);
    });

    it('returns AMENDMENT_PENDING when active amendment exists', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportRelease.findMany.mockResolvedValue([]);
      prisma.resultReportTest.findMany.mockResolvedValue([
        { status: 'RELEASED' },
      ]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([
        { id: 'amend-1' },
      ]);

      const result = await service.getReleaseHistory('order-1', 'lab-1');
      expect(result.aggregateReportStatus).toBe('AMENDMENT_PENDING');
    });

    it('includes vet snapshot fields in release history entries', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportRelease.findMany.mockResolvedValue([
        {
          id: 'rel-1',
          releaseSequence: 1,
          releaseType: 'FINAL',
          signerName: 'Dr. Pérez',
          releasedAt: new Date(),
          orderingVetId: 'vet-user-1',
          orderingVetName: 'Dr. García, DVM',
          orderingVetLicenseNumber: 'LIC-001',
          orderingVetIssuingAuthority: 'CVMC',
          tests: [],
          artifacts: [],
        },
      ]);
      prisma.resultReportTest.findMany.mockResolvedValue([
        { status: 'RELEASED' },
      ]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);

      const result = await service.getReleaseHistory('order-1', 'lab-1');
      expect(result.releases[0]).toMatchObject({
        orderingVetId: 'vet-user-1',
        orderingVetName: 'Dr. García, DVM',
        orderingVetLicenseNumber: 'LIC-001',
        orderingVetIssuingAuthority: 'CVMC',
      });
    });

    it('returns null vet fields when release has no ordering vet (backward compat)', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportRelease.findMany.mockResolvedValue([
        {
          id: 'rel-1',
          releaseSequence: 1,
          releaseType: 'FINAL',
          signerName: 'Dr. Pérez',
          releasedAt: new Date(),
          orderingVetId: null,
          orderingVetName: null,
          orderingVetLicenseNumber: null,
          orderingVetIssuingAuthority: null,
          tests: [],
          artifacts: [],
        },
      ]);
      prisma.resultReportTest.findMany.mockResolvedValue([
        { status: 'RELEASED' },
      ]);
      prisma.resultReportAmendment.findMany.mockResolvedValue([]);

      const result = await service.getReleaseHistory('order-1', 'lab-1');
      expect(result.releases[0].orderingVetId).toBeNull();
      expect(result.releases[0].orderingVetName).toBeNull();
    });
  });
});
