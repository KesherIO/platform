import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TemplateVersionService } from './template-version.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VERSION = {
  id: 'ver-1',
  definitionId: 'def-1',
  version: 1,
  title: 'Hemograma Canino',
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
          technique: null,
          valueType: 'NUMERIC',
          unit: 'g/dL',
          options: [],
          sortOrder: 1,
          isHeader: false,
          formula: null,
          referenceRange: { min: 12, max: 18, displayText: '12 – 18' },
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
      technique: null,
      valueType: 'NUMERIC',
      unit: 'g/dL',
      options: [],
      sortOrder: 1,
      isHeader: false,
      formula: null,
      referenceRange: { min: 12, max: 18, displayText: '12 – 18' },
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makePrismaMock() {
  const mock = {
    resultTemplateDefinition: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    resultTemplateVersion: {
      findUnique: jest.fn(),
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
    $transaction: jest
      .fn()
      .mockImplementation((cb: (tx: typeof mock) => Promise<unknown>) =>
        cb(mock)
      ),
  };
  return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TemplateVersionService', () => {
  let service: TemplateVersionService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateVersionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(TemplateVersionService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  // ── listDefinitions ───────────────────────────────────────────────────────

  describe('listDefinitions', () => {
    it('queries PLATFORM and LABORATORY definitions for the tenant', async () => {
      prisma.resultTemplateDefinition.findMany.mockResolvedValue([DEFINITION]);

      const result = await service.listDefinitions('lab-1');

      expect(prisma.resultTemplateDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { scope: 'PLATFORM' },
              { scope: 'LABORATORY', labTenantId: 'lab-1' },
            ],
          }),
        })
      );
      expect(result).toHaveLength(1);
    });

    it('applies catalogItemCode filter', async () => {
      prisma.resultTemplateDefinition.findMany.mockResolvedValue([]);

      await service.listDefinitions('lab-1', { catalogItemCode: 'CBC' });

      expect(prisma.resultTemplateDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ catalogItemCode: 'CBC' }),
        })
      );
    });
  });

  // ── getDefinition ─────────────────────────────────────────────────────────

  describe('getDefinition', () => {
    it('returns definition with active version', async () => {
      prisma.resultTemplateDefinition.findUnique.mockResolvedValue({
        ...DEFINITION,
        activeVersion: VERSION,
        versions: [VERSION],
      });

      const result = await service.getDefinition('def-1');

      expect(result.id).toBe('def-1');
      expect(result.activeVersion).toBeDefined();
    });

    it('throws NotFoundException when not found', async () => {
      prisma.resultTemplateDefinition.findUnique.mockResolvedValue(null);

      await expect(service.getDefinition('missing')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── createDefinition ──────────────────────────────────────────────────────

  describe('createDefinition', () => {
    it('creates a LABORATORY definition with DRAFT version', async () => {
      prisma.resultTemplateDefinition.create.mockResolvedValue({
        id: 'def-new',
      });
      prisma.resultTemplateVersion.create.mockResolvedValue({ id: 'ver-new' });
      prisma.resultTemplateSection.create.mockResolvedValue({ id: 'sec-new' });
      prisma.resultTemplateAnalyte.create.mockResolvedValue({ id: 'ta-new' });
      prisma.resultTemplateDefinition.findUnique.mockResolvedValue({
        ...DEFINITION,
        id: 'def-new',
        scope: 'LABORATORY',
      });

      await service.createDefinition('lab-1', {
        catalogItemCode: 'CBC',
        species: 'DOG' as any,
        title: 'CBC Lab',
        sections: [
          {
            name: 'Section 1',
            sortOrder: 1,
            analytes: [
              {
                code: 'WBC',
                name: 'WBC',
                valueType: 'NUMERIC' as any,
                sortOrder: 1,
              },
            ],
          },
        ],
      });

      expect(prisma.resultTemplateDefinition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scope: 'LABORATORY',
            ownerKey: 'lab-1',
          }),
        })
      );
    });
  });

  // ── cloneFromPlatform ─────────────────────────────────────────────────────

  describe('cloneFromPlatform', () => {
    it('throws NotFoundException for missing definition', async () => {
      prisma.resultTemplateDefinition.findUnique.mockResolvedValue(null);

      await expect(
        service.cloneFromPlatform('lab-1', 'missing')
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for non-PLATFORM scope', async () => {
      prisma.resultTemplateDefinition.findUnique.mockResolvedValue({
        ...DEFINITION,
        scope: 'LABORATORY',
        activeVersion: VERSION,
      });

      await expect(service.cloneFromPlatform('lab-1', 'def-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws ConflictException when lab already has a clone', async () => {
      prisma.resultTemplateDefinition.findUnique
        .mockResolvedValueOnce({ ...DEFINITION, activeVersion: VERSION })
        .mockResolvedValueOnce({ id: 'existing-clone' });

      await expect(service.cloneFromPlatform('lab-1', 'def-1')).rejects.toThrow(
        ConflictException
      );
    });
  });

  // ── publishVersion ────────────────────────────────────────────────────────

  describe('publishVersion', () => {
    it('publishes a DRAFT version and archives the old PUBLISHED one', async () => {
      prisma.resultTemplateVersion.findUnique.mockResolvedValue({
        ...VERSION,
        id: 'ver-draft',
        status: 'DRAFT',
        definition: { ...DEFINITION, activeVersionId: 'ver-old' },
      });
      prisma.resultTemplateVersion.update.mockResolvedValue({
        ...VERSION,
        id: 'ver-draft',
        status: 'PUBLISHED',
      });
      prisma.resultTemplateDefinition.update.mockResolvedValue({});

      await service.publishVersion('ver-draft');

      // Archives old version
      expect(prisma.resultTemplateVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ver-old' },
          data: { status: 'ARCHIVED' },
        })
      );

      // Publishes new version
      expect(prisma.resultTemplateVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ver-draft' },
          data: expect.objectContaining({ status: 'PUBLISHED' }),
        })
      );
    });

    it('throws BadRequestException for non-DRAFT version', async () => {
      prisma.resultTemplateVersion.findUnique.mockResolvedValue({
        ...VERSION,
        status: 'PUBLISHED',
        definition: DEFINITION,
      });

      await expect(service.publishVersion('ver-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws NotFoundException for missing version', async () => {
      prisma.resultTemplateVersion.findUnique.mockResolvedValue(null);

      await expect(service.publishVersion('missing')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── archiveVersion ────────────────────────────────────────────────────────

  describe('archiveVersion', () => {
    it('archives a PUBLISHED version and clears activeVersionId', async () => {
      prisma.resultTemplateVersion.findUnique.mockResolvedValue({
        ...VERSION,
        status: 'PUBLISHED',
        definition: DEFINITION,
      });
      prisma.resultTemplateVersion.update.mockResolvedValue({
        ...VERSION,
        status: 'ARCHIVED',
      });
      prisma.resultTemplateDefinition.update.mockResolvedValue({});

      await service.archiveVersion('ver-1');

      expect(prisma.resultTemplateDefinition.update).toHaveBeenCalledWith({
        where: { id: 'def-1' },
        data: { activeVersionId: null },
      });
    });

    it('throws BadRequestException for non-PUBLISHED version', async () => {
      prisma.resultTemplateVersion.findUnique.mockResolvedValue({
        ...VERSION,
        status: 'DRAFT',
        definition: DEFINITION,
      });

      await expect(service.archiveVersion('ver-1')).rejects.toThrow(
        BadRequestException
      );
    });
  });

  // ── resolveTemplate ───────────────────────────────────────────────────────

  describe('resolveTemplate', () => {
    it('returns null when no matching definition', async () => {
      prisma.resultTemplateDefinition.findMany.mockResolvedValue([]);

      const result = await service.resolveTemplate(
        'CBC',
        'lab-1',
        'DOG' as any,
        null
      );

      expect(result).toBeNull();
    });

    it('prefers LABORATORY over PLATFORM', async () => {
      const platformDef = {
        ...DEFINITION,
        id: 'def-platform',
        scope: 'PLATFORM',
        activeVersion: VERSION,
      };
      const labDef = {
        ...DEFINITION,
        id: 'def-lab',
        scope: 'LABORATORY',
        labTenantId: 'lab-1',
        ownerKey: 'lab-1',
        activeVersion: { ...VERSION, id: 'ver-lab' },
      };
      prisma.resultTemplateDefinition.findMany.mockResolvedValue([
        platformDef,
        labDef,
      ]);

      const result = await service.resolveTemplate(
        'CBC',
        'lab-1',
        'DOG' as any,
        null
      );

      expect(result?.id).toBe('def-lab');
    });

    it('prefers species-specific over ANY', async () => {
      const anyDef = {
        ...DEFINITION,
        id: 'def-any',
        species: 'ANY',
        activeVersion: VERSION,
      };
      const dogDef = {
        ...DEFINITION,
        id: 'def-dog',
        species: 'DOG',
        activeVersion: { ...VERSION, id: 'ver-dog' },
      };
      prisma.resultTemplateDefinition.findMany.mockResolvedValue([
        anyDef,
        dogDef,
      ]);

      const result = await service.resolveTemplate(
        'CBC',
        'lab-1',
        'DOG' as any,
        null
      );

      expect(result?.id).toBe('def-dog');
    });
  });
});
