import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';

const LAB_A = 'lab-a';
const LAB_B = 'lab-b';

const MOCK_ITEM = {
  id: 'item1',
  labTenantId: LAB_A,
  kind: 'TEST',
  code: 'CBC',
  name: 'Complete Blood Count',
  description: null,
  category: 'Hematology',
  turnaroundHours: 4,
  resultType: null,
  unit: null,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  components: [],
};

describe('CatalogService', () => {
  let service: CatalogService;
  let prisma: {
    clinicLabConnection: { findFirst: ReturnType<typeof jest.fn> };
    catalogItem: {
      findMany: ReturnType<typeof jest.fn>;
      findUnique: ReturnType<typeof jest.fn>;
      findFirst: ReturnType<typeof jest.fn>;
      count: ReturnType<typeof jest.fn>;
      create: ReturnType<typeof jest.fn>;
      createManyAndReturn: ReturnType<typeof jest.fn>;
      update: ReturnType<typeof jest.fn>;
      deleteMany: ReturnType<typeof jest.fn>;
    };
    catalogItemComposition: {
      deleteMany: ReturnType<typeof jest.fn>;
      createMany: ReturnType<typeof jest.fn>;
    };
    caseCatalogItem: { count: ReturnType<typeof jest.fn> };
    orderedTest: { count: ReturnType<typeof jest.fn> };
    $executeRaw: ReturnType<typeof jest.fn>;
    $transaction: ReturnType<typeof jest.fn>;
  };

  beforeEach(async () => {
    prisma = {
      clinicLabConnection: {
        findFirst: jest.fn().mockResolvedValue({ labId: LAB_A }),
      },
      catalogItem: {
        findMany: jest.fn().mockResolvedValue([MOCK_ITEM]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({ id: 'new1', labTenantId: LAB_A }),
        createManyAndReturn: jest.fn().mockResolvedValue([]),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'item1', labTenantId: LAB_A }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      catalogItemComposition: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
      caseCatalogItem: { count: jest.fn().mockResolvedValue(0) },
      orderedTest: { count: jest.fn().mockResolvedValue(0) },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: typeof prisma) => Promise<void>) =>
          cb(prisma)
        ),
    };

    const module = await Test.createTestingModule({
      providers: [CatalogService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CatalogService);
  });

  it('creates without error', () => {
    expect(service).toBeTruthy();
  });

  // ── findAll (clinic-facing) ─────────────────────────────────────────────────

  describe('findAll', () => {
    it("resolves the clinic's default active lab connection and scopes by it", async () => {
      const result = await service.findAll('clinic-1');
      expect(prisma.clinicLabConnection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clinicId: 'clinic-1', isActive: true },
        })
      );
      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { labTenantId: LAB_A, active: true },
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('item1');
    });

    it('returns an empty array when the clinic has no active lab connection', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(null);
      const result = await service.findAll('clinic-1');
      expect(result).toEqual([]);
      expect(prisma.catalogItem.findMany).not.toHaveBeenCalled();
    });

    it('maps resultType and unit fields', async () => {
      prisma.catalogItem.findMany.mockResolvedValue([
        { ...MOCK_ITEM, resultType: 'NUMERIC', unit: 'mg/dL', components: [] },
      ]);
      const result = await service.findAll('clinic-1');
      expect(result[0].resultType).toBe('NUMERIC');
      expect(result[0].unit).toBe('mg/dL');
    });
  });

  // ── import ────────────────────────────────────────────────────────────────

  describe('import', () => {
    /** The lab's current catalog, read once at the start of the import */
    const existing = (
      rows: { id: string; code: string | null; name: string }[]
    ) => prisma.catalogItem.findMany.mockResolvedValueOnce(rows);

    it("reads this lab's catalog once, then creates new items in one query", async () => {
      existing([]);
      prisma.catalogItem.createManyAndReturn.mockResolvedValue([
        { id: 'n1', code: 'NT', name: 'New Test' },
        { id: 'n2', code: 'NT2', name: 'Other' },
      ]);

      const result = await service.import({
        labTenantId: LAB_A,
        items: [
          { kind: 'TEST' as const, name: 'New Test', code: 'NT' },
          { kind: 'TEST' as const, name: 'Other', code: 'NT2' },
        ],
      });

      expect(result).toEqual({ created: 2, updated: 0 });
      expect(prisma.catalogItem.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { labTenantId: LAB_A } })
      );
      expect(prisma.catalogItem.createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(
        prisma.catalogItem.createManyAndReturn.mock.calls[0][0].data
      ).toEqual([
        expect.objectContaining({ labTenantId: LAB_A, code: 'NT' }),
        expect.objectContaining({ labTenantId: LAB_A, code: 'NT2' }),
      ]);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.catalogItem.findFirst).not.toHaveBeenCalled();
    });

    it('updates items whose code exists in this lab, in one query', async () => {
      existing([{ id: 'item1', code: 'CBC', name: 'Hemograma' }]);

      const result = await service.import({
        labTenantId: LAB_A,
        items: [{ kind: 'TEST' as const, name: 'Updated Test', code: 'CBC' }],
      });

      expect(result).toEqual({ created: 0, updated: 1 });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.catalogItem.createManyAndReturn).not.toHaveBeenCalled();
      // the UPDATE is scoped to the lab and carries the row values
      const values = prisma.$executeRaw.mock.calls[0].slice(1);
      expect(values).toEqual(expect.arrayContaining([LAB_A]));
    });

    it('uses name as fallback key for items without a code', async () => {
      existing([{ id: 'pkg-old', code: null, name: 'Wellness Panel' }]);

      const result = await service.import({
        labTenantId: LAB_A,
        items: [
          { kind: 'PACKAGE' as const, name: 'Wellness Panel' },
          { kind: 'PACKAGE' as const, name: 'Brand New Panel' },
        ],
      });

      expect(result).toEqual({ created: 1, updated: 1 });
      expect(
        prisma.catalogItem.createManyAndReturn.mock.calls[0][0].data
      ).toEqual([expect.objectContaining({ name: 'Brand New Panel' })]);
    });

    it('a key repeated in one import is created once and counted as an update', async () => {
      existing([]);

      const result = await service.import({
        labTenantId: LAB_A,
        items: [
          { kind: 'TEST' as const, name: 'First', code: 'X' },
          { kind: 'TEST' as const, name: 'Second', code: 'X' },
        ],
      });

      expect(result).toEqual({ created: 1, updated: 1 });
      expect(
        prisma.catalogItem.createManyAndReturn.mock.calls[0][0].data
      ).toEqual([expect.objectContaining({ code: 'X', name: 'Second' })]);
    });

    it("replace:true only deletes this lab's items", async () => {
      existing([]);
      await service.import({
        labTenantId: LAB_A,
        replace: true,
        items: [{ kind: 'TEST' as const, name: 'New Test', code: 'NT' }],
      });
      expect(prisma.catalogItem.deleteMany).toHaveBeenCalledWith({
        where: { labTenantId: LAB_A },
      });
    });

    it('without replace:true does not call deleteMany', async () => {
      existing([]);
      await service.import({
        labTenantId: LAB_A,
        items: [{ kind: 'TEST' as const, name: 'New Test', code: 'NT' }],
      });
      expect(prisma.catalogItem.deleteMany).not.toHaveBeenCalled();
    });

    it("wires package compositions from this lab's catalog and this import", async () => {
      existing([{ id: 'comp1', code: 'CBC', name: 'Hemograma' }]);
      prisma.catalogItem.createManyAndReturn.mockResolvedValue([
        { id: 'chem1', code: 'CHEM', name: 'Química' },
        { id: 'pkg1', code: 'MINI', name: 'Mini Panel' },
      ]);

      await service.import({
        labTenantId: LAB_A,
        items: [
          { kind: 'TEST' as const, name: 'Química', code: 'CHEM' },
          {
            kind: 'PACKAGE' as const,
            name: 'Mini Panel',
            code: 'MINI',
            componentCodes: ['CBC', 'CHEM', 'CBC'],
          },
        ],
      });

      expect(prisma.catalogItemComposition.deleteMany).toHaveBeenCalledWith({
        where: { packageId: { in: ['pkg1'] } },
      });
      expect(prisma.catalogItemComposition.createMany).toHaveBeenCalledWith({
        data: [
          { packageId: 'pkg1', componentId: 'comp1' },
          { packageId: 'pkg1', componentId: 'chem1' },
        ],
        skipDuplicates: true,
      });
    });

    it('throws BadRequestException for a missing component, before writing', async () => {
      existing([]);

      await expect(
        service.import({
          labTenantId: LAB_A,
          items: [
            {
              kind: 'PACKAGE' as const,
              name: 'Bad Panel',
              code: 'BAD',
              componentCodes: ['MISSING'],
            },
          ],
        })
      ).rejects.toThrow('MISSING');
      expect(prisma.catalogItem.createManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  // ── findAllAdmin ──────────────────────────────────────────────────────────

  describe('findAllAdmin', () => {
    it('scopes list + count to labTenantId', async () => {
      await service.findAllAdmin(LAB_A, {});
      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { labTenantId: LAB_A } })
      );
      expect(prisma.catalogItem.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { labTenantId: LAB_A } })
      );
    });

    it('carries createdAt/updatedAt through to the mapped response', async () => {
      const result = await service.findAllAdmin(LAB_A, {});
      expect(result.data[0].createdAt).toEqual(MOCK_ITEM.createdAt);
      expect(result.data[0].updatedAt).toEqual(MOCK_ITEM.updatedAt);
    });

    it('includes package components so the edit form can pre-fill them', async () => {
      prisma.catalogItem.findMany.mockResolvedValue([
        {
          ...MOCK_ITEM,
          kind: 'PACKAGE',
          components: [{ component: { ...MOCK_ITEM, id: 'comp1' } }],
        },
      ]);
      const result = await service.findAllAdmin(LAB_A, {});
      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { components: { include: { component: true } } },
        })
      );
      expect(result.data[0].components).toEqual([
        expect.objectContaining({ id: 'comp1' }),
      ]);
    });

    it('adds a case-insensitive name filter when search is given', async () => {
      await service.findAllAdmin(LAB_A, { search: 'hemo' });
      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            labTenantId: LAB_A,
            name: { contains: 'hemo', mode: 'insensitive' },
          },
        })
      );
    });

    it('narrows the list by kind without narrowing the per-kind counts', async () => {
      prisma.catalogItem.count
        .mockResolvedValueOnce(39) // all
        .mockResolvedValueOnce(34) // TEST
        .mockResolvedValueOnce(5); // PACKAGE

      const result = await service.findAllAdmin(LAB_A, {
        kind: 'TEST' as any,
      });

      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { labTenantId: LAB_A, kind: 'TEST' },
        })
      );
      // Counts always reflect all three kinds, regardless of the active filter.
      expect(result.counts).toEqual({ all: 39, TEST: 34, PACKAGE: 5 });
      // total mirrors the count for the currently-selected kind.
      expect(result.total).toBe(34);
    });

    it('total falls back to the all-kinds count when no kind filter is given', async () => {
      prisma.catalogItem.count
        .mockResolvedValueOnce(39)
        .mockResolvedValueOnce(34)
        .mockResolvedValueOnce(5);

      const result = await service.findAllAdmin(LAB_A, {});

      expect(result.total).toBe(39);
      expect(result.counts).toEqual({ all: 39, TEST: 34, PACKAGE: 5 });
    });
  });

  // ── createItem ────────────────────────────────────────────────────────────

  describe('createItem', () => {
    it('creates with labTenantId taken from the argument, not client input', async () => {
      await service.createItem(LAB_A, { kind: 'TEST' as any, name: 'Glucose' });
      expect(prisma.catalogItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            labTenantId: LAB_A,
            name: 'Glucose',
          }),
        })
      );
    });

    it('throws ConflictException when the code is already used in this lab', async () => {
      prisma.catalogItem.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.createItem(LAB_A, {
          kind: 'TEST' as any,
          name: 'Dup',
          code: 'CBC',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('rejects componentIds belonging to a different lab', async () => {
      // resolveOwnComponentIds finds 0 owned items for LAB_A when the id belongs to LAB_B
      prisma.catalogItem.findMany.mockResolvedValueOnce([]);
      await expect(
        service.createItem(LAB_A, {
          kind: 'PACKAGE' as any,
          name: 'Cross-lab package',
          componentIds: ['lab-b-item'],
        })
      ).rejects.toThrow(/not found in this lab/);
    });

    it('wires componentIds that do belong to this lab', async () => {
      prisma.catalogItem.findMany.mockResolvedValueOnce([
        { id: 'comp1', kind: 'TEST' },
      ]);
      prisma.catalogItem.create.mockResolvedValue({
        id: 'pkg1',
        labTenantId: LAB_A,
      });

      await service.createItem(LAB_A, {
        kind: 'PACKAGE' as any,
        name: 'Panel',
        componentIds: ['comp1'],
      });

      expect(prisma.catalogItemComposition.createMany).toHaveBeenCalledWith({
        data: [{ packageId: 'pkg1', componentId: 'comp1' }],
      });
    });

    it('rejects a PACKAGE component that is itself a PACKAGE', async () => {
      prisma.catalogItem.findMany.mockResolvedValueOnce([
        { id: 'pkg2', kind: 'PACKAGE' },
      ]);
      await expect(
        service.createItem(LAB_A, {
          kind: 'PACKAGE' as any,
          name: 'Nested panel',
          componentIds: ['pkg2'],
        })
      ).rejects.toThrow(/only contain TEST items/);
    });
  });

  // ── updateItem — cross-lab isolation ──────────────────────────────────────

  describe('updateItem', () => {
    it('updates an item owned by this lab', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: LAB_A });
      await service.updateItem(LAB_A, 'item1', { name: 'Renamed' });
      expect(prisma.catalogItem.update).toHaveBeenCalledWith({
        where: { id: 'item1' },
        data: { name: 'Renamed' },
      });
    });

    it('throws NotFoundException when the item belongs to another lab', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: LAB_B });
      await expect(
        service.updateItem(LAB_A, 'item1', { name: 'Hijack' })
      ).rejects.toThrow(NotFoundException);
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the item does not exist', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue(null);
      await expect(
        service.updateItem(LAB_A, 'missing', { name: 'X' })
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the new code collides within the same lab', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: LAB_A });
      prisma.catalogItem.findFirst.mockResolvedValue({ id: 'other-item' });
      await expect(
        service.updateItem(LAB_A, 'item1', { code: 'TAKEN' })
      ).rejects.toThrow(ConflictException);
    });

    it('rejects componentIds belonging to a different lab on update', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: LAB_A });
      prisma.catalogItem.findMany.mockResolvedValueOnce([]); // none owned by LAB_A
      await expect(
        service.updateItem(LAB_A, 'pkg1', { componentIds: ['lab-b-item'] })
      ).rejects.toThrow(/not found in this lab/);
    });

    it('rejects a package that lists itself as a component', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: LAB_A });
      await expect(
        service.updateItem(LAB_A, 'pkg1', { componentIds: ['pkg1'] })
      ).rejects.toThrow(/cannot contain itself/);
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
    });

    it('rejects a non-TEST component on update', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: LAB_A });
      prisma.catalogItem.findMany.mockResolvedValueOnce([
        { id: 'pkg2', kind: 'PACKAGE' },
      ]);
      await expect(
        service.updateItem(LAB_A, 'pkg1', { componentIds: ['pkg2'] })
      ).rejects.toThrow(/only contain TEST items/);
    });

    it('blocks a code change once the item has been used on a case', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({
        labTenantId: LAB_A,
        code: 'OLD',
      });
      prisma.caseCatalogItem.count.mockResolvedValue(1);
      await expect(
        service.updateItem(LAB_A, 'item1', { code: 'NEW' })
      ).rejects.toThrow(/already been used on a case or order/);
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
    });

    it('blocks a code change once the item has been used on an order', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({
        labTenantId: LAB_A,
        code: 'OLD',
      });
      prisma.orderedTest.count.mockResolvedValue(1);
      await expect(
        service.updateItem(LAB_A, 'item1', { code: 'NEW' })
      ).rejects.toThrow(/already been used on a case or order/);
    });

    it('allows a code change when the item has never been used', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({
        labTenantId: LAB_A,
        code: 'OLD',
      });
      await service.updateItem(LAB_A, 'item1', { code: 'NEW' });
      expect(prisma.catalogItem.update).toHaveBeenCalledWith({
        where: { id: 'item1' },
        data: { code: 'NEW' },
      });
    });

    it('does not re-check usage when the submitted code is unchanged', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({
        labTenantId: LAB_A,
        code: 'SAME',
      });
      await service.updateItem(LAB_A, 'item1', {
        code: 'SAME',
        name: 'Renamed',
      });
      expect(prisma.caseCatalogItem.count).not.toHaveBeenCalled();
      expect(prisma.orderedTest.count).not.toHaveBeenCalled();
      expect(prisma.catalogItem.update).toHaveBeenCalledWith({
        where: { id: 'item1' },
        data: { code: 'SAME', name: 'Renamed' },
      });
    });
  });

  // ── setActive — cross-lab isolation ───────────────────────────────────────

  describe('setActive', () => {
    it('enables/disables an item owned by this lab', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: LAB_A });
      await service.setActive(LAB_A, 'item1', false);
      expect(prisma.catalogItem.update).toHaveBeenCalledWith({
        where: { id: 'item1' },
        data: { active: false },
      });
    });

    it('throws NotFoundException when the item belongs to another lab', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: LAB_B });
      await expect(service.setActive(LAB_A, 'item1', false)).rejects.toThrow(
        NotFoundException
      );
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
    });
  });
});
