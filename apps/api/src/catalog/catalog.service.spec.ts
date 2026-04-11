import { Test } from '@nestjs/testing';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';

const MOCK_ITEM = {
  id: 'item1',
  kind: 'TEST',
  code: 'CBC',
  name: 'Complete Blood Count',
  description: null,
  category: 'Hematology',
  turnaroundHours: 4,
  resultType: null,
  unit: null,
  active: true,
  components: [],
};

describe('CatalogService', () => {
  let service: CatalogService;
  let prisma: {
    catalogItem: {
      findMany: ReturnType<typeof jest.fn>;
      findUnique: ReturnType<typeof jest.fn>;
      findFirst: ReturnType<typeof jest.fn>;
      create: ReturnType<typeof jest.fn>;
      update: ReturnType<typeof jest.fn>;
      deleteMany: ReturnType<typeof jest.fn>;
    };
    catalogItemComposition: {
      deleteMany: ReturnType<typeof jest.fn>;
      createMany: ReturnType<typeof jest.fn>;
    };
    $transaction: ReturnType<typeof jest.fn>;
  };

  beforeEach(async () => {
    prisma = {
      catalogItem: {
        findMany: jest.fn().mockResolvedValue([MOCK_ITEM]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'new1' }),
        update: jest.fn().mockResolvedValue({ id: 'item1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      catalogItemComposition: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
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

  it('findAll returns mapped catalog items', async () => {
    const result = await service.findAll();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('item1');
    expect(result[0].kind).toBe('TEST');
    expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } })
    );
  });

  it('import returns created/updated counts', async () => {
    prisma.catalogItem.findFirst.mockResolvedValue(null);
    const result = await service.import({
      items: [{ kind: 'TEST' as const, name: 'New Test', code: 'NT' }],
    });
    expect(result).toEqual({ created: 1, updated: 0 });
  });

  it('import updates existing item when code matches', async () => {
    prisma.catalogItem.findUnique.mockResolvedValue({ id: 'item1' });
    const result = await service.import({
      items: [{ kind: 'TEST' as const, name: 'Updated Test', code: 'CBC' }],
    });
    expect(result).toEqual({ created: 0, updated: 1 });
  });

  it('import with replace:true calls deleteMany before inserting', async () => {
    prisma.catalogItem.findFirst.mockResolvedValue(null);
    await service.import({
      replace: true,
      items: [{ kind: 'TEST' as const, name: 'New Test', code: 'NT' }],
    });
    expect(prisma.catalogItem.deleteMany).toHaveBeenCalledWith({});
  });

  it('import without replace:true does not call deleteMany', async () => {
    prisma.catalogItem.findFirst.mockResolvedValue(null);
    await service.import({
      items: [{ kind: 'TEST' as const, name: 'New Test', code: 'NT' }],
    });
    expect(prisma.catalogItem.deleteMany).not.toHaveBeenCalled();
  });

  it('import uses name as fallback key when code is absent', async () => {
    prisma.catalogItem.findFirst.mockResolvedValue(null);
    const result = await service.import({
      items: [{ kind: 'PACKAGE' as const, name: 'Wellness Panel' }],
    });
    expect(result).toEqual({ created: 1, updated: 0 });
    expect(prisma.catalogItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'Wellness Panel' } })
    );
  });

  it('import persists resultType and unit fields', async () => {
    prisma.catalogItem.findFirst.mockResolvedValue(null);
    await service.import({
      items: [
        {
          kind: 'TEST' as const,
          name: 'Glucose',
          code: 'GLU',
          resultType: 'NUMERIC' as any,
          unit: 'mg/dL',
        },
      ],
    });
    expect(prisma.catalogItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resultType: 'NUMERIC', unit: 'mg/dL' }),
      })
    );
  });

  it('import wires package compositions when componentCodes are provided', async () => {
    // Pass 1: package created
    prisma.catalogItem.findUnique.mockResolvedValue(null);
    prisma.catalogItem.create.mockResolvedValueOnce({ id: 'pkg1' });
    // Pass 2: resolve component IDs
    prisma.catalogItem.findMany
      .mockResolvedValueOnce([MOCK_ITEM]) // initial findAll call won't run here
      .mockResolvedValueOnce([{ id: 'comp1', code: 'CBC' }]);

    await service.import({
      items: [
        {
          kind: 'PACKAGE' as const,
          name: 'Mini Panel',
          code: 'MINI',
          componentCodes: ['CBC'],
        },
      ],
    });

    expect(prisma.catalogItemComposition.deleteMany).toHaveBeenCalledWith({
      where: { packageId: 'pkg1' },
    });
    expect(prisma.catalogItemComposition.createMany).toHaveBeenCalledWith({
      data: [{ packageId: 'pkg1', componentId: 'comp1' }],
    });
  });

  it('import throws BadRequestException when a componentCode is not found', async () => {
    prisma.catalogItem.findUnique.mockResolvedValue(null);
    prisma.catalogItem.create.mockResolvedValue({ id: 'pkg1' });
    // Pass 2: component not found in catalog
    prisma.catalogItem.findMany.mockResolvedValueOnce([]);

    await expect(
      service.import({
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
  });

  it('findAll maps resultType and unit fields', async () => {
    prisma.catalogItem.findMany.mockResolvedValue([
      { ...MOCK_ITEM, resultType: 'NUMERIC', unit: 'mg/dL', components: [] },
    ]);
    const result = await service.findAll();
    expect(result[0].resultType).toBe('NUMERIC');
    expect(result[0].unit).toBe('mg/dL');
  });

  it('findAll passes where:active:true so inactive items are excluded', async () => {
    await service.findAll();
    expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } })
    );
  });
});
