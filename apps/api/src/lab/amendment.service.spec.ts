import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AmendmentService } from './amendment.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatusService } from './order-status.service';

describe('AmendmentService', () => {
  let service: AmendmentService;
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

  function buildPrismaMock() {
    return {
      order: { findFirst: jest.fn() },
      resultReport: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      resultReportTest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      resultReportAmendment: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      resultReportAmendmentAnalyte: {
        create: jest.fn(),
        update: jest.fn(),
      },
      resultReportReleaseTest: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      resultReportRelease: { create: jest.fn() },
      resultReportReleaseAnalyte: { create: jest.fn() },
      resultReportReleaseArtifact: { create: jest.fn() },
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
        AmendmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrderStatusService, useValue: orderStatusService },
      ],
    }).compile();

    service = module.get<AmendmentService>(AmendmentService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('initiateAmendment', () => {
    it('scenario 14: throws BadRequestException without reason', async () => {
      await expect(
        service.initiateAmendment({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          reportTestId: 'rt-1',
          reason: '',
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('scenario 15: throws BadRequestException for non-released test', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportTest.findUnique.mockResolvedValue({
        id: 'rt-1',
        reportId: 'report-1',
        status: 'IN_REVIEW',
        latestReleaseId: null,
      });

      await expect(
        service.initiateAmendment({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          reportTestId: 'rt-1',
          reason: 'Incorrect WBC value',
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when active amendment already exists', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportTest.findUnique.mockResolvedValue({
        id: 'rt-1',
        reportId: 'report-1',
        status: 'RELEASED',
        latestReleaseId: 'rel-1',
      });
      prisma.resultReportAmendment.findFirst.mockResolvedValue({
        id: 'amend-1',
      });

      await expect(
        service.initiateAmendment({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          reportTestId: 'rt-1',
          reason: 'Incorrect WBC value',
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('creates amendment with DRAFT status and copies analytes from release snapshot', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportTest.findUnique.mockResolvedValue({
        id: 'rt-1',
        reportId: 'report-1',
        status: 'RELEASED',
        latestReleaseId: 'rel-1',
      });
      prisma.resultReportAmendment.findFirst.mockResolvedValue(null);
      prisma.resultReportReleaseTest.findFirst.mockResolvedValue({
        id: 'rlt-1',
        catalogItemName: 'Hemogram',
        analytes: [
          {
            id: 'rla-1',
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
            flag: 'N',
            referenceSnapshot: { min: 5.5, max: 16.9 },
          },
        ],
      });

      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = buildPrismaMock();
        tx.resultReportAmendment.create.mockResolvedValue({
          id: 'amend-1',
          status: 'DRAFT',
        });
        tx.resultReportAmendmentAnalyte.create.mockResolvedValue({
          id: 'ama-1',
          code: 'WBC',
          name: 'White Blood Cells',
          numericValue: 12.5,
          flag: 'N',
        });
        tx.timelineEvent.create.mockResolvedValue({});
        return fn(tx);
      });

      const result = await service.initiateAmendment({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        reportTestId: 'rt-1',
        reason: 'Incorrect WBC value',
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.amendmentId).toBe('amend-1');
      expect(result.status).toBe('DRAFT');
      expect(result.analytes).toHaveLength(1);
    });
  });

  describe('editAmendmentAnalytes', () => {
    it('throws BadRequestException when amendment is not DRAFT', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'IN_REVIEW',
        reportTest: { report: { orderId: 'order-1' } },
      });

      await expect(
        service.editAmendmentAnalytes({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          amendmentId: 'amend-1',
          analytes: [{ id: 'ama-1', numericValue: 15.0 }],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('updates analyte values on DRAFT amendment', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'DRAFT',
        reportTest: { report: { orderId: 'order-1' } },
      });
      prisma.resultReportAmendmentAnalyte.update.mockResolvedValue({});

      const result = await service.editAmendmentAnalytes({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        amendmentId: 'amend-1',
        analytes: [{ id: 'ama-1', numericValue: 15.0 }],
      });

      expect(result.updated).toBe(1);
      expect(prisma.resultReportAmendmentAnalyte.update).toHaveBeenCalledWith({
        where: { id: 'ama-1' },
        data: {
          numericValue: 15.0,
          textValue: null,
          booleanValue: null,
          selectValue: null,
        },
      });
    });
  });

  describe('submitForReview', () => {
    it('throws BadRequestException when amendment is not DRAFT', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'APPROVED',
        analytes: [],
        reportTest: { report: { orderId: 'order-1' } },
      });

      await expect(
        service.submitForReview({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          amendmentId: 'amend-1',
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('transitions to IN_REVIEW when all analytes have values', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'DRAFT',
        analytes: [
          {
            id: 'ama-1',
            code: 'WBC',
            name: 'WBC',
            isHeader: false,
            formula: null,
            numericValue: 15.0,
            textValue: null,
            booleanValue: null,
            selectValue: null,
          },
        ],
        reportTest: { report: { orderId: 'order-1' } },
      });
      prisma.resultReportAmendment.update.mockResolvedValue({});
      prisma.timelineEvent.create.mockResolvedValue({});

      const result = await service.submitForReview({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        amendmentId: 'amend-1',
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.status).toBe('IN_REVIEW');
    });
  });

  describe('approveAmendment', () => {
    it('scenario 16: amendment does not reopen test/order — OrderedTest stays COMPLETED', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        caseId: 'case-1',
        requisitionNumber: 'REQ-001',
        priority: 'NORMAL',
        clinicNotes: null,
        createdAt: new Date(),
        tenantId: 'clinic-1',
        labTenantId: 'lab-1',
        resultReport: { id: 'report-1', currentReleaseSequence: 1 },
      });

      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'IN_REVIEW',
        report: { orderId: 'order-1' },
        reportTest: {
          id: 'rt-1',
          orderedTestId: 'ot-1',
          latestReleaseId: 'rel-1',
          templateDefinition: { id: 'td-1' },
          templateVersion: { id: 'tv-1', title: 'Hemogram', version: 1 },
          orderedTest: {
            catalogItemCode: 'HMG',
            catalogItemName: 'Hemogram',
            department: 'Hematology',
            processingMethod: 'AUTO',
            entryMethod: 'MANUAL',
            startedAt: new Date(),
            completedAt: new Date(),
            specimens: [
              {
                specimen: { accessionNumber: 'ACC-001', specimenType: 'BLOOD' },
              },
            ],
          },
        },
        analytes: [
          {
            id: 'ama-1',
            code: 'WBC',
            name: 'WBC',
            sectionName: 'CBC',
            sortOrder: 1,
            isHeader: false,
            valueType: 'NUMERIC',
            numericValue: 15.0,
            textValue: null,
            booleanValue: null,
            selectValue: null,
            unit: 'K/uL',
            technique: null,
            formula: null,
            flag: 'N',
            referenceSnapshot: { min: 5.5, max: 16.9 },
          },
        ],
      });

      prisma.labSigner.findUnique
        .mockResolvedValueOnce(baseSigner)
        .mockResolvedValueOnce(baseSigner);
      prisma.resultReportReleaseTest.findFirst.mockResolvedValue({
        id: 'rlt-1',
      });

      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = buildPrismaMock();
        tx.$queryRaw.mockResolvedValue([]);
        tx.resultReport.findUniqueOrThrow.mockResolvedValue({
          currentReleaseSequence: 1,
        });
        tx.resultReportRelease.create.mockResolvedValue({ id: 'rel-2' });
        tx.resultReportReleaseTest.create.mockResolvedValue({ id: 'rlt-2' });
        tx.resultReportReleaseAnalyte.create.mockResolvedValue({});
        tx.resultReportReleaseArtifact.create.mockResolvedValue({});
        tx.resultReportTest.update.mockResolvedValue({});
        tx.resultReportAmendment.update.mockResolvedValue({});
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
        return fn(tx);
      });

      prisma.resultReportAmendment.findMany.mockResolvedValue([]);

      const result = await service.approveAmendment({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        amendmentId: 'amend-1',
        signerId: 'signer-1',
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.releaseType).toBe('AMENDMENT');
      expect(result.releaseSequence).toBe(2);
      expect(result.amendsReleaseTestId).toBe('rlt-1');
      expect(result.aggregateReportStatus).toBe('ALL_RELEASED');
    });

    it('scenario 17: report status unaffected by pending amendment', async () => {
      // When an amendment is in DRAFT, the ResultReport.status stays RELEASED.
      // This is enforced by the design: initiateAmendment does NOT update ResultReport.status.
      // The report status is only updated during releases, not amendment creation.
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportTest.findUnique.mockResolvedValue({
        id: 'rt-1',
        reportId: 'report-1',
        status: 'RELEASED',
        latestReleaseId: 'rel-1',
      });
      prisma.resultReportAmendment.findFirst.mockResolvedValue(null);
      prisma.resultReportReleaseTest.findFirst.mockResolvedValue({
        id: 'rlt-1',
        catalogItemName: 'Hemogram',
        analytes: [],
      });

      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = buildPrismaMock();
        tx.resultReportAmendment.create.mockResolvedValue({
          id: 'amend-1',
          status: 'DRAFT',
        });
        tx.timelineEvent.create.mockResolvedValue({});
        return fn(tx);
      });

      const result = await service.initiateAmendment({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        reportTestId: 'rt-1',
        reason: 'Typo correction',
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.status).toBe('DRAFT');
      // Verify ResultReport.update was NOT called by the transaction
      const txFn = prisma.$transaction.mock.calls[0][0];
      const tx = buildPrismaMock();
      tx.resultReportAmendment.create.mockResolvedValue({
        id: 'amend-1',
        status: 'DRAFT',
      });
      tx.timelineEvent.create.mockResolvedValue({});
      await txFn(tx);
      expect(tx.resultReport.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when amendment is not IN_REVIEW', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        caseId: 'case-1',
        requisitionNumber: 'REQ-001',
        priority: 'NORMAL',
        clinicNotes: null,
        createdAt: new Date(),
        tenantId: 'clinic-1',
        labTenantId: 'lab-1',
        resultReport: { id: 'report-1', currentReleaseSequence: 1 },
      });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'DRAFT',
        report: { orderId: 'order-1' },
        reportTest: { id: 'rt-1' },
        analytes: [],
      });

      await expect(
        service.approveAmendment({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          amendmentId: 'amend-1',
          signerId: 'signer-1',
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when signer does not belong to lab', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        caseId: 'case-1',
        requisitionNumber: 'REQ-001',
        priority: 'NORMAL',
        clinicNotes: null,
        createdAt: new Date(),
        tenantId: 'clinic-1',
        labTenantId: 'lab-1',
        resultReport: { id: 'report-1', currentReleaseSequence: 1 },
      });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'IN_REVIEW',
        report: { orderId: 'order-1' },
        reportTest: { id: 'rt-1' },
        analytes: [],
      });
      prisma.labSigner.findUnique.mockResolvedValue({
        ...baseSigner,
        laboratoryProfile: { tenantId: 'other-lab' },
      });

      await expect(
        service.approveAmendment({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          amendmentId: 'amend-1',
          signerId: 'signer-1',
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getAmendment', () => {
    it('returns amendment with analytes and source comparison data', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'DRAFT',
        reportTestId: 'rt-1',
        sourceReleaseId: 'rel-1',
        analytes: [{ id: 'ama-1', code: 'WBC', name: 'WBC', sortOrder: 1 }],
        reportTest: {
          id: 'rt-1',
          orderedTestId: 'ot-1',
          templateVersion: { title: 'Hemogram' },
        },
        report: { orderId: 'order-1' },
      });
      prisma.resultReportReleaseAnalyte = {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'rla-1', code: 'WBC', name: 'WBC', numericValue: 12.5 },
          ]),
      };

      const result = await service.getAmendment('order-1', 'lab-1', 'amend-1');

      expect(result.amendment.id).toBe('amend-1');
      expect(result.amendment.analytes).toHaveLength(1);
      expect(result.sourceAnalytes).toHaveLength(1);
    });

    it('throws NotFoundException when amendment belongs to different order', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        report: { orderId: 'other-order' },
      });

      await expect(
        service.getAmendment('order-1', 'lab-1', 'amend-1')
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when amendment not found', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        resultReport: { id: 'report-1' },
      });
      prisma.resultReportAmendment.findUnique.mockResolvedValue(null);

      await expect(
        service.getAmendment('order-1', 'lab-1', 'amend-1')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelAmendment', () => {
    it('scenario 20: cancel leaves original intact — status CANCELLED, test stays RELEASED', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'DRAFT',
        reportTest: { report: { orderId: 'order-1' } },
      });
      prisma.resultReportAmendment.update.mockResolvedValue({});
      prisma.timelineEvent.create.mockResolvedValue({});

      const result = await service.cancelAmendment({
        orderId: 'order-1',
        labTenantId: 'lab-1',
        amendmentId: 'amend-1',
        actorId: 'user-1',
        actorName: 'User',
      });

      expect(result.status).toBe('CANCELLED');
      expect(prisma.resultReportTest.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when amendment is already APPROVED', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'APPROVED',
        reportTest: { report: { orderId: 'order-1' } },
      });

      await expect(
        service.cancelAmendment({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          amendmentId: 'amend-1',
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when amendment is already CANCELLED', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.resultReportAmendment.findUnique.mockResolvedValue({
        id: 'amend-1',
        status: 'CANCELLED',
        reportTest: { report: { orderId: 'order-1' } },
      });

      await expect(
        service.cancelAmendment({
          orderId: 'order-1',
          labTenantId: 'lab-1',
          amendmentId: 'amend-1',
          actorId: 'user-1',
          actorName: 'User',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });
});
