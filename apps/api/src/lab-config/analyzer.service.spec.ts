import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnalyzerService } from './analyzer.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateAnalyzerDto,
  UpdateAnalyzerDto,
} from './dto/lab-config.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'lab-tenant-1';

const ANALYZER = {
  id: 'analyzer-1',
  labTenantId: TENANT_ID,
  name: 'BioSystems A25',
  model: 'A25',
  manufacturer: 'BioSystems',
  department: 'CHEMISTRY',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ANALYZER_2 = {
  id: 'analyzer-2',
  labTenantId: TENANT_ID,
  name: 'Sysmex XN-1000',
  model: 'XN-1000',
  manufacturer: 'Sysmex',
  department: 'HEMATOLOGY',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makePrismaMock() {
  return {
    analyzer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyzerService', () => {
  let service: AnalyzerService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyzerService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AnalyzerService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  // ── listAnalyzers ─────────────────────────────────────────────────────────

  describe('listAnalyzers', () => {
    it('returns all analyzers for the tenant', async () => {
      prisma.analyzer.findMany.mockResolvedValue([ANALYZER, ANALYZER_2]);

      const result = await service.listAnalyzers(TENANT_ID);

      expect(result).toEqual([ANALYZER, ANALYZER_2]);
      expect(prisma.analyzer.findMany).toHaveBeenCalledWith({
        where: { labTenantId: TENANT_ID },
        orderBy: { name: 'asc' },
      });
    });
  });

  // ── getAnalyzer ───────────────────────────────────────────────────────────

  describe('getAnalyzer', () => {
    it('returns the analyzer', async () => {
      prisma.analyzer.findFirst.mockResolvedValue(ANALYZER);

      const result = await service.getAnalyzer(TENANT_ID, 'analyzer-1');

      expect(result).toEqual(ANALYZER);
      expect(prisma.analyzer.findFirst).toHaveBeenCalledWith({
        where: { id: 'analyzer-1', labTenantId: TENANT_ID },
      });
    });

    it('throws NotFoundException when not found', async () => {
      prisma.analyzer.findFirst.mockResolvedValue(null);

      await expect(
        service.getAnalyzer(TENANT_ID, 'nonexistent')
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── createAnalyzer ────────────────────────────────────────────────────────

  describe('createAnalyzer', () => {
    const dto: CreateAnalyzerDto = {
      name: 'BioSystems A25',
      model: 'A25',
      manufacturer: 'BioSystems',
      department: 'CHEMISTRY' as CreateAnalyzerDto['department'],
    };

    it('creates with correct data', async () => {
      prisma.analyzer.create.mockResolvedValue(ANALYZER);

      const result = await service.createAnalyzer(TENANT_ID, dto);

      expect(result).toEqual(ANALYZER);
      expect(prisma.analyzer.create).toHaveBeenCalledWith({
        data: {
          labTenantId: TENANT_ID,
          name: 'BioSystems A25',
          model: 'A25',
          manufacturer: 'BioSystems',
          department: 'CHEMISTRY',
        },
      });
    });

    it('passes the tenant ID correctly', async () => {
      prisma.analyzer.create.mockResolvedValue(ANALYZER);

      await service.createAnalyzer(TENANT_ID, dto);

      expect(prisma.analyzer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ labTenantId: TENANT_ID }),
        })
      );
    });
  });

  // ── updateAnalyzer ────────────────────────────────────────────────────────

  describe('updateAnalyzer', () => {
    const dto: UpdateAnalyzerDto = {
      name: 'BioSystems A25 v2',
      model: 'A25-v2',
    };

    it('updates with correct data', async () => {
      prisma.analyzer.findFirst.mockResolvedValue(ANALYZER);
      prisma.analyzer.update.mockResolvedValue({
        ...ANALYZER,
        name: 'BioSystems A25 v2',
        model: 'A25-v2',
      });

      const result = await service.updateAnalyzer(TENANT_ID, 'analyzer-1', dto);

      expect(result.name).toBe('BioSystems A25 v2');
      expect(result.model).toBe('A25-v2');
      expect(prisma.analyzer.update).toHaveBeenCalledWith({
        where: { id: 'analyzer-1' },
        data: {
          name: 'BioSystems A25 v2',
          model: 'A25-v2',
        },
      });
    });

    it('throws NotFoundException when not found', async () => {
      prisma.analyzer.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAnalyzer(TENANT_ID, 'nonexistent', dto)
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── toggleActive ──────────────────────────────────────────────────────────

  describe('toggleActive', () => {
    it('sets isActive to false', async () => {
      prisma.analyzer.findFirst.mockResolvedValue(ANALYZER);
      prisma.analyzer.update.mockResolvedValue({
        ...ANALYZER,
        isActive: false,
      });

      const result = await service.toggleActive(TENANT_ID, 'analyzer-1', false);

      expect(result.isActive).toBe(false);
      expect(prisma.analyzer.update).toHaveBeenCalledWith({
        where: { id: 'analyzer-1' },
        data: { isActive: false },
      });
    });

    it('sets isActive to true', async () => {
      prisma.analyzer.findFirst.mockResolvedValue({
        ...ANALYZER,
        isActive: false,
      });
      prisma.analyzer.update.mockResolvedValue({ ...ANALYZER, isActive: true });

      const result = await service.toggleActive(TENANT_ID, 'analyzer-1', true);

      expect(result.isActive).toBe(true);
      expect(prisma.analyzer.update).toHaveBeenCalledWith({
        where: { id: 'analyzer-1' },
        data: { isActive: true },
      });
    });

    it('throws NotFoundException when not found', async () => {
      prisma.analyzer.findFirst.mockResolvedValue(null);

      await expect(
        service.toggleActive(TENANT_ID, 'nonexistent', false)
      ).rejects.toThrow(NotFoundException);
    });
  });
});
