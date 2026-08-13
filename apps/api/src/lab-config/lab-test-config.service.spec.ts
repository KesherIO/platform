import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LabTestConfigService } from './lab-test-config.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG = {
  id: 'cfg-1',
  labTenantId: 'lab-1',
  catalogItemId: 'cat-1',
  department: 'HEMATOLOGY',
  defaultProcessingMethod: 'MANUAL',
  allowedProcessingMethods: ['MANUAL'],
  defaultAnalyzerId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  catalogItem: { id: 'cat-1', name: 'CBC', code: 'CBC', kind: 'TEST' },
  defaultAnalyzer: null,
  specimenRequirements: [],
};

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makePrismaMock() {
  const mock = {
    labTestConfiguration: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    labTestSpecimenRequirement: {
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

describe('LabTestConfigService', () => {
  let service: LabTestConfigService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabTestConfigService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(LabTestConfigService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  // ── listConfigs ───────────────────────────────────────────────────────────

  describe('listConfigs', () => {
    it('returns all configs for the tenant', async () => {
      prisma.labTestConfiguration.findMany.mockResolvedValue([CONFIG]);

      const result = await service.listConfigs('lab-1');

      expect(result).toHaveLength(1);
      expect(prisma.labTestConfiguration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { labTenantId: 'lab-1' },
        })
      );
    });
  });

  // ── getConfig ─────────────────────────────────────────────────────────────

  describe('getConfig', () => {
    it('returns the config when found', async () => {
      prisma.labTestConfiguration.findFirst.mockResolvedValue(CONFIG);

      const result = await service.getConfig('lab-1', 'cfg-1');

      expect(result.id).toBe('cfg-1');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.labTestConfiguration.findFirst.mockResolvedValue(null);

      await expect(service.getConfig('lab-1', 'missing')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── upsertConfig ──────────────────────────────────────────────────────────

  describe('upsertConfig', () => {
    const dto = {
      catalogItemId: 'cat-1',
      department: 'HEMATOLOGY' as const,
      defaultProcessingMethod: 'MANUAL' as const,
      allowedProcessingMethods: ['MANUAL' as const],
    };

    it('creates a new config when none exists', async () => {
      prisma.labTestConfiguration.findUnique.mockResolvedValue(null);
      prisma.labTestConfiguration.create.mockResolvedValue(CONFIG);

      await service.upsertConfig('lab-1', dto);

      expect(prisma.labTestConfiguration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            labTenantId: 'lab-1',
            catalogItemId: 'cat-1',
            department: 'HEMATOLOGY',
          }),
        })
      );
    });

    it('updates an existing config', async () => {
      prisma.labTestConfiguration.findUnique.mockResolvedValue(CONFIG);
      prisma.labTestConfiguration.update.mockResolvedValue(CONFIG);

      await service.upsertConfig('lab-1', dto);

      expect(prisma.labTestConfiguration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cfg-1' },
        })
      );
    });

    it('replaces specimen requirements on update', async () => {
      prisma.labTestConfiguration.findUnique.mockResolvedValue(CONFIG);
      prisma.labTestSpecimenRequirement.deleteMany.mockResolvedValue({});
      prisma.labTestConfiguration.update.mockResolvedValue(CONFIG);

      await service.upsertConfig('lab-1', {
        ...dto,
        specimenRequirements: [
          {
            specimenType: 'BLOOD',
            containerType: 'EDTA',
            requirementGroupKey: 'group-1',
          },
        ],
      });

      expect(prisma.labTestSpecimenRequirement.deleteMany).toHaveBeenCalledWith(
        { where: { labTestConfigurationId: 'cfg-1' } }
      );
    });
  });

  // ── deleteConfig ──────────────────────────────────────────────────────────

  describe('deleteConfig', () => {
    it('deletes an existing config', async () => {
      prisma.labTestConfiguration.findFirst.mockResolvedValue(CONFIG);
      prisma.labTestConfiguration.delete.mockResolvedValue({});

      await service.deleteConfig('lab-1', 'cfg-1');

      expect(prisma.labTestConfiguration.delete).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
      });
    });

    it('throws NotFoundException when config not found', async () => {
      prisma.labTestConfiguration.findFirst.mockResolvedValue(null);

      await expect(service.deleteConfig('lab-1', 'missing')).rejects.toThrow(
        NotFoundException
      );
    });
  });
});
