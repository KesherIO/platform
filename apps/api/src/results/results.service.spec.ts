import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResultsService } from './results.service';
import { TemplateVersionService } from './template-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from '../rag/rag.service';
import type {
  ImportTemplateDto,
  CreateReportDto,
  SaveAnalytesDto,
  ReleaseReportDto,
} from './dto/results.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATALOG_ITEM = { id: 'cat-1', code: 'CBC' };

const VERSION = {
  id: 'ver-1',
  definitionId: 'def-1',
  version: 1,
  title: 'Hemograma Canino Adulto',
  status: 'PUBLISHED',
  defaultObservations: null,
  publishedAt: new Date(),
  createdAt: new Date(),
  sections: [
    {
      id: 'sec-1',
      versionId: 'ver-1',
      name: 'Serie Roja',
      sortOrder: 1,
      analytes: [
        {
          id: 'ta-1',
          versionId: 'ver-1',
          sectionId: 'sec-1',
          code: 'HGB',
          name: 'Hemoglobina',
          technique: 'Colorimétrico',
          valueType: 'NUMERIC',
          unit: 'g/dL',
          options: [],
          sortOrder: 1,
          isHeader: false,
          formula: null,
          referenceRange: { min: 12.0, max: 18.0, displayText: '12.0 – 18.0' },
        },
      ],
    },
  ],
  analytes: [
    {
      id: 'ta-1',
      versionId: 'ver-1',
      sectionId: 'sec-1',
      code: 'HGB',
      name: 'Hemoglobina',
      technique: 'Colorimétrico',
      valueType: 'NUMERIC',
      unit: 'g/dL',
      options: [],
      sortOrder: 1,
      isHeader: false,
      formula: null,
      referenceRange: { min: 12.0, max: 18.0, displayText: '12.0 – 18.0' },
    },
  ],
};

const DEFINITION = {
  id: 'def-1',
  catalogItemCode: 'CBC',
  species: 'DOG',
  ageMinWeeks: -1,
  ageMaxWeeks: -1,
  scope: 'PLATFORM',
  labTenantId: null,
  ownerKey: 'platform',
  parentDefinitionId: null,
  activeVersionId: 'ver-1',
  activeVersion: VERSION,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ORDER = {
  id: 'order-1',
  caseId: 'case-1',
  tenantId: 'tenant-1',
  orderedItems: [
    { catalogItemId: 'cat-1', code: 'CBC', name: 'CBC', kind: 'TEST' },
  ],
  case: { patientSpecies: 'DOG', patientAge: null, patientAgeUnit: null },
  createdAt: new Date(),
};

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1',
    orderId: 'order-1',
    caseId: 'case-1',
    tenantId: 'tenant-1',
    templateId: 'ver-1',
    status: 'DRAFT',
    observations: null,
    processedByName: null,
    processedByRole: null,
    processedByCredentials: null,
    approvedByName: null,
    approvedByRole: null,
    approvedByCredentials: null,
    signatureUrl: null,
    pdfUrl: null,
    rawPayload: null,
    releasedAt: null,
    releasedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    analytes: [],
    ...overrides,
  };
}

function makeAnalyte(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ra-1',
    reportId: 'report-1',
    templateAnalyteId: 'ta-1',
    code: 'HGB',
    name: 'Hemoglobina',
    technique: 'Colorimétrico',
    unit: 'g/dL',
    valueType: 'NUMERIC',
    sectionName: 'Serie Roja',
    sortOrder: 1,
    isHeader: false,
    numericValue: null,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    flag: null,
    referenceSnapshot: null,
    templateAnalyte: {
      referenceRange: { min: 12.0, max: 18.0, displayText: '12.0 – 18.0' },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makePrismaMock() {
  const mock = {
    catalogItem: { findFirst: jest.fn(), findMany: jest.fn() },
    resultTemplateDefinition: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    resultTemplateVersion: {
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    resultTemplateSection: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    resultTemplateAnalyte: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    resultReport: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    resultReportAnalyte: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    order: { findUnique: jest.fn(), findFirst: jest.fn() },
    case: { update: jest.fn() },
    catalogItemComposition: { findMany: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation((cb: (tx: typeof mock) => Promise<unknown>) =>
        cb(mock)
      ),
  };
  return mock;
}

function makeTemplateVersionServiceMock() {
  return {
    resolveTemplate: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResultsService', () => {
  let service: ResultsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let templateVersionService: ReturnType<typeof makeTemplateVersionServiceMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    templateVersionService = makeTemplateVersionServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'test-key', get: () => undefined },
        },
        {
          provide: RagService,
          useValue: { retrieveRelevantChunks: async () => [] },
        },
        {
          provide: TemplateVersionService,
          useValue: templateVersionService,
        },
      ],
    }).compile();

    service = module.get(ResultsService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  // ── importTemplate ─────────────────────────────────────────────────────────

  describe('importTemplate', () => {
    const dto: ImportTemplateDto = {
      labTenantId: 'lab-1',
      catalogItemCode: 'CBC',
      species: 'DOG' as ImportTemplateDto['species'],
      title: 'Hemograma Canino Adulto',
      sections: [
        {
          name: 'Serie Roja',
          sortOrder: 1,
          analytes: [
            {
              code: 'HGB',
              name: 'Hemoglobina',
              technique: 'Colorimétrico',
              valueType: 'NUMERIC' as const,
              unit: 'g/dL',
              sortOrder: 1,
              referenceRange: {
                min: 12.0,
                max: 18.0,
                displayText: '12.0 – 18.0',
              },
            },
          ],
        },
      ],
    };

    it('creates a new definition when none exists', async () => {
      prisma.catalogItem.findFirst.mockResolvedValue(CATALOG_ITEM);
      prisma.resultTemplateDefinition.findUnique.mockResolvedValue(null);
      prisma.resultTemplateDefinition.create.mockResolvedValue({ id: 'def-1' });
      prisma.resultTemplateVersion.aggregate.mockResolvedValue({
        _max: { version: null },
      });
      prisma.resultTemplateVersion.create.mockResolvedValue({ id: 'ver-1' });
      prisma.resultTemplateSection.create.mockResolvedValue({ id: 'sec-1' });
      prisma.resultTemplateAnalyte.create.mockResolvedValue({ id: 'ta-1' });
      prisma.resultTemplateDefinition.update.mockResolvedValue({});
      prisma.resultTemplateDefinition.findUniqueOrThrow.mockResolvedValue(
        DEFINITION
      );

      const result = await service.importTemplate(dto);

      expect(prisma.resultTemplateDefinition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            catalogItemCode: 'CBC',
            species: 'DOG',
            scope: 'PLATFORM',
            ownerKey: 'platform',
          }),
        })
      );
      expect(result.title).toBe('Hemograma Canino Adulto');
      expect(result.sections).toHaveLength(1);
    });

    it('archives old version and creates new when definition exists', async () => {
      prisma.catalogItem.findFirst.mockResolvedValue(CATALOG_ITEM);
      prisma.resultTemplateDefinition.findUnique.mockResolvedValue({
        id: 'def-1',
        activeVersionId: 'ver-old',
      });
      prisma.resultTemplateVersion.update.mockResolvedValue({});
      prisma.resultTemplateVersion.aggregate.mockResolvedValue({
        _max: { version: 1 },
      });
      prisma.resultTemplateVersion.create.mockResolvedValue({ id: 'ver-2' });
      prisma.resultTemplateSection.create.mockResolvedValue({ id: 'sec-1' });
      prisma.resultTemplateAnalyte.create.mockResolvedValue({ id: 'ta-1' });
      prisma.resultTemplateDefinition.update.mockResolvedValue({});
      prisma.resultTemplateDefinition.findUniqueOrThrow.mockResolvedValue({
        ...DEFINITION,
        activeVersion: { ...VERSION, id: 'ver-2', version: 2 },
      });

      await service.importTemplate(dto);

      expect(prisma.resultTemplateVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ver-old' },
          data: { status: 'ARCHIVED' },
        })
      );
    });

    it('throws NotFoundException when catalogItemCode is not found', async () => {
      prisma.catalogItem.findFirst.mockResolvedValue(null);

      await expect(service.importTemplate(dto)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── createReport ───────────────────────────────────────────────────────────

  describe('createReport', () => {
    const dto: CreateReportDto = { orderId: 'order-1' };

    it('creates a report with analytes from the resolved template', async () => {
      prisma.resultReport.findUnique.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue(ORDER);
      prisma.catalogItemComposition.findMany.mockResolvedValue([]);
      prisma.catalogItem.findMany.mockResolvedValue([CATALOG_ITEM]);
      templateVersionService.resolveTemplate.mockResolvedValue(DEFINITION);
      prisma.resultReport.create.mockResolvedValue({ id: 'report-1' });
      prisma.resultReportAnalyte.createMany.mockResolvedValue({});
      prisma.resultReport.findUniqueOrThrow.mockResolvedValue(
        makeReport({ analytes: [makeAnalyte()] })
      );

      const result = await service.createReport(dto);

      expect(prisma.resultReport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order-1',
            caseId: 'case-1',
            tenantId: 'tenant-1',
            status: 'DRAFT',
          }),
        })
      );
      expect(result.status).toBe('DRAFT');
      expect(result.analytes).toHaveLength(1);
      expect(result.analytes[0].code).toBe('HGB');
    });

    it('throws ConflictException when a report already exists for the order', async () => {
      prisma.resultReport.findUnique.mockResolvedValue({ id: 'report-1' });

      await expect(service.createReport(dto)).rejects.toThrow(
        ConflictException
      );
    });

    it('throws NotFoundException when order does not exist', async () => {
      prisma.resultReport.findUnique.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.createReport(dto)).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws NotFoundException when no matching template is found', async () => {
      prisma.resultReport.findUnique.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue(ORDER);
      prisma.catalogItemComposition.findMany.mockResolvedValue([]);
      prisma.catalogItem.findMany.mockResolvedValue([CATALOG_ITEM]);
      templateVersionService.resolveTemplate.mockResolvedValue(null);

      await expect(service.createReport(dto)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── saveAnalytes ───────────────────────────────────────────────────────────

  describe('saveAnalytes', () => {
    const dto: SaveAnalytesDto = {
      analytes: [{ analyteId: 'ra-1', numericValue: 15.2 }],
    };

    it('updates analyte values on a DRAFT report', async () => {
      prisma.resultReport.findUnique.mockResolvedValue(
        makeReport({ status: 'DRAFT' })
      );
      prisma.resultReportAnalyte.updateMany.mockResolvedValue({ count: 1 });
      prisma.resultReport.findUniqueOrThrow.mockResolvedValue(
        makeReport({ analytes: [makeAnalyte({ numericValue: 15.2 })] })
      );

      const result = await service.saveAnalytes('report-1', dto);

      expect(prisma.resultReportAnalyte.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ra-1', reportId: 'report-1' },
          data: expect.objectContaining({ numericValue: 15.2 }),
        })
      );
      expect(result.analytes[0].numericValue).toBe(15.2);
    });

    it('throws BadRequestException on a RELEASED report', async () => {
      prisma.resultReport.findUnique.mockResolvedValue(
        makeReport({ status: 'RELEASED' })
      );

      await expect(service.saveAnalytes('report-1', dto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws NotFoundException when report does not exist', async () => {
      prisma.resultReport.findUnique.mockResolvedValue(null);

      await expect(service.saveAnalytes('nonexistent', dto)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── releaseReport ──────────────────────────────────────────────────────────

  describe('releaseReport', () => {
    const dto: ReleaseReportDto = {
      processedByName: 'Luis Giraldo',
      processedByRole: 'Analista',
      approvedByName: 'Carlos Canaval',
      approvedByRole: 'Jefe de Laboratorio',
    };

    beforeEach(() => {
      prisma.resultReport.findUnique.mockResolvedValue(
        makeReport({ status: 'DRAFT', caseId: 'case-1' })
      );
      prisma.resultReportAnalyte.findMany.mockResolvedValue([
        makeAnalyte({ numericValue: 8.2 }),
      ]);
      prisma.resultReportAnalyte.update.mockResolvedValue({});
      prisma.resultReport.update.mockResolvedValue({});
      prisma.case.update.mockResolvedValue({});
      prisma.resultReport.findUniqueOrThrow.mockResolvedValue(
        makeReport({
          status: 'RELEASED',
          analytes: [makeAnalyte({ numericValue: 8.2, flag: 'L' })],
        })
      );
    });

    it('sets status to RELEASED', async () => {
      await service.releaseReport('report-1', dto);

      expect(prisma.resultReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RELEASED' }),
        })
      );
    });

    it('computes flag L when value is below reference min', async () => {
      await service.releaseReport('report-1', dto);

      expect(prisma.resultReportAnalyte.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ flag: 'L' }),
        })
      );
    });

    it('computes flag H when value is above reference max', async () => {
      prisma.resultReportAnalyte.findMany.mockResolvedValue([
        makeAnalyte({ numericValue: 22.0 }),
      ]);

      await service.releaseReport('report-1', dto);

      expect(prisma.resultReportAnalyte.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ flag: 'H' }),
        })
      );
    });

    it('computes flag N when value is within range', async () => {
      prisma.resultReportAnalyte.findMany.mockResolvedValue([
        makeAnalyte({ numericValue: 15.2 }),
      ]);

      await service.releaseReport('report-1', dto);

      expect(prisma.resultReportAnalyte.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ flag: 'N' }),
        })
      );
    });

    it('sets null flag for non-numeric analytes', async () => {
      prisma.resultReportAnalyte.findMany.mockResolvedValue([
        makeAnalyte({
          valueType: 'TEXT',
          textValue: 'Ligeramente turbio',
          numericValue: null,
        }),
      ]);

      await service.releaseReport('report-1', dto);

      expect(prisma.resultReportAnalyte.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ flag: null }),
        })
      );
    });

    it('advances the case to COMPLETED', async () => {
      await service.releaseReport('report-1', dto);

      expect(prisma.case.update).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: { status: 'COMPLETED' },
      });
    });

    it('stores professional footer on the report', async () => {
      await service.releaseReport('report-1', dto);

      expect(prisma.resultReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            processedByName: 'Luis Giraldo',
            approvedByName: 'Carlos Canaval',
          }),
        })
      );
    });

    it('throws BadRequestException when report is already RELEASED', async () => {
      prisma.resultReport.findUnique.mockResolvedValue(
        makeReport({ status: 'RELEASED' })
      );

      await expect(service.releaseReport('report-1', dto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws NotFoundException when report does not exist', async () => {
      prisma.resultReport.findUnique.mockResolvedValue(null);

      await expect(service.releaseReport('nonexistent', dto)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── findReportByOrderId ────────────────────────────────────────────────────

  describe('findReportByOrderId', () => {
    it('returns the report for the correct tenant', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.resultReport.findFirst.mockResolvedValue(
        makeReport({ status: 'RELEASED' })
      );

      const result = await service.findReportByOrderId('tenant-1', 'REQ-001');

      expect(result.orderId).toBe('order-1');
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { requisitionNumber: 'REQ-001', tenantId: 'tenant-1' },
        })
      );
      expect(prisma.resultReport.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: 'order-1', tenantId: 'tenant-1' },
        })
      );
    });

    it('throws NotFoundException when order is not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.findReportByOrderId('tenant-99', 'REQ-999')
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a different tenant', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.resultReport.findFirst.mockResolvedValue(null);

      await expect(
        service.findReportByOrderId('tenant-99', 'REQ-001')
      ).rejects.toThrow(NotFoundException);
    });
  });
});
