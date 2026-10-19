import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';

const LAB_A = 'lab-a';

const RAW = {
  id: 'item1',
  labTenantId: LAB_A,
  kind: 'TEST',
  code: 'CBC',
  billingCode: 'HEM',
  name: 'Hemograma',
  description: null,
  category: null,
  turnaroundHours: null,
  resultType: null,
  unit: null,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  components: [],
};

describe('CatalogService — billing codes', () => {
  let service: CatalogService;
  let prisma: {
    clinicLabConnection: { findFirst: jest.Mock };
    catalogItem: Record<string, jest.Mock>;
    catalogItemComposition: Record<string, jest.Mock>;
    caseCatalogItem: { count: jest.Mock };
    orderedTest: { count: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      clinicLabConnection: {
        findFirst: jest.fn().mockResolvedValue({ labId: LAB_A }),
      },
      catalogItem: {
        findMany: jest.fn().mockResolvedValue([RAW]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ labTenantId: LAB_A, code: 'CBC' }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(RAW),
        createManyAndReturn: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(RAW),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      catalogItemComposition: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      // The item was already used on cases and orders
      caseCatalogItem: { count: jest.fn().mockResolvedValue(3) },
      orderedTest: { count: jest.fn().mockResolvedValue(5) },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) =>
          cb(prisma)
        ),
    };
    const module = await Test.createTestingModule({
      providers: [CatalogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CatalogService);
  });

  it("never sends the lab's billing code to clinics (GET /catalog)", async () => {
    const items = await service.findAll('clinic-1');
    expect(items[0]).not.toHaveProperty('billingCode');
  });

  it('the lab admin list includes it', async () => {
    const res = await service.findAllAdmin(LAB_A, {});
    expect(res.data[0].billingCode).toBe('HEM');
  });

  describe('createItem', () => {
    it('stores a trimmed billing code', async () => {
      await service.createItem(LAB_A, {
        kind: 'TEST',
        name: 'Hemograma',
        billingCode: '  HEM  ',
      } as never);
      expect(prisma.catalogItem.create.mock.calls[0][0].data.billingCode).toBe(
        'HEM'
      );
    });

    it('rejects a code another item of the lab already has (case-insensitive)', async () => {
      prisma.catalogItem.findFirst.mockResolvedValueOnce({ name: 'Otro' });
      await expect(
        service.createItem(LAB_A, {
          kind: 'TEST',
          name: 'Hemograma',
          billingCode: 'hem',
        } as never)
      ).rejects.toThrow(ConflictException);
      expect(prisma.catalogItem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            labTenantId: LAB_A,
            billingCode: { equals: 'hem', mode: 'insensitive' },
          }),
        })
      );
      expect(prisma.catalogItem.create).not.toHaveBeenCalled();
    });

    it('rejects a code with a line break', async () => {
      await expect(
        service.createItem(LAB_A, {
          kind: 'TEST',
          name: 'X',
          billingCode: 'A\nB',
        } as never)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateItem', () => {
    it('sets the billing code even though the item is already used on orders', async () => {
      await service.updateItem(LAB_A, 'item1', { billingCode: 'HEM1' });
      expect(prisma.catalogItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { billingCode: 'HEM1' } })
      );
    });

    it('does not touch the internal code, ids or anything else', async () => {
      await service.updateItem(LAB_A, 'item1', { billingCode: 'HEM1' });
      const data = prisma.catalogItem.update.mock.calls[0][0].data;
      expect(Object.keys(data)).toEqual(['billingCode']);
    });

    it('an empty value clears the code', async () => {
      await service.updateItem(LAB_A, 'item1', { billingCode: '  ' });
      expect(prisma.catalogItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { billingCode: null } })
      );
    });

    it('leaves it alone when the field is not sent', async () => {
      await service.updateItem(LAB_A, 'item1', { name: 'Nuevo' });
      expect(prisma.catalogItem.update.mock.calls[0][0].data).toEqual({
        name: 'Nuevo',
      });
    });

    it('rejects a code used by a different item, ignoring the item itself', async () => {
      prisma.catalogItem.findFirst.mockResolvedValueOnce({ name: 'Otro' });
      await expect(
        service.updateItem(LAB_A, 'item1', { billingCode: 'ALT' })
      ).rejects.toThrow(ConflictException);
      expect(prisma.catalogItem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'item1' } }),
        })
      );
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
    });
  });

  describe('import', () => {
    const row = (name: string, code: string, billingCode?: string) => ({
      kind: 'TEST' as const,
      name,
      code,
      billingCode,
    });

    it('creates a new item with its billing code', async () => {
      prisma.catalogItem.findMany.mockResolvedValueOnce([]);
      prisma.catalogItem.createManyAndReturn.mockResolvedValue([
        { id: 'n1', code: 'A', name: 'A' },
      ]);
      await service.import({
        labTenantId: LAB_A,
        items: [row('A', 'A', 'BILL-A')],
      });
      expect(
        prisma.catalogItem.createManyAndReturn.mock.calls[0][0].data[0]
      ).toMatchObject({ code: 'A', billingCode: 'BILL-A' });
    });

    it('a re-import without billing codes keeps the existing ones (null = keep)', async () => {
      prisma.catalogItem.findMany.mockResolvedValueOnce([
        { id: 'item1', code: 'CBC', name: 'Hemograma', billingCode: 'HEM' },
      ]);
      await service.import({
        labTenantId: LAB_A,
        items: [row('Hemograma v2', 'CBC')],
      });
      const sql = JSON.stringify(prisma.$executeRaw.mock.calls[0][0]);
      expect(sql).toContain('COALESCE(v.billing_code');
    });

    it('rejects two different items with the same billing code', async () => {
      prisma.catalogItem.findMany.mockResolvedValueOnce([]);
      await expect(
        service.import({
          labTenantId: LAB_A,
          items: [row('A', 'A', 'DUP'), row('B', 'B', 'dup')],
        })
      ).rejects.toThrow(BadRequestException);
      expect(prisma.catalogItem.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('rejects a code an untouched existing item already uses', async () => {
      prisma.catalogItem.findMany.mockResolvedValueOnce([
        { id: 'item1', code: 'CBC', name: 'Hemograma', billingCode: 'HEM' },
      ]);
      await expect(
        service.import({
          labTenantId: LAB_A,
          items: [row('Albumina', 'ALB', 'HEM')],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('allows moving a code from one existing item to another in the same file', async () => {
      prisma.catalogItem.findMany.mockResolvedValueOnce([
        { id: 'i1', code: 'A', name: 'A', billingCode: 'X' },
        { id: 'i2', code: 'B', name: 'B', billingCode: null },
      ]);
      await expect(
        service.import({
          labTenantId: LAB_A,
          items: [row('A', 'A', 'Y'), row('B', 'B', 'X')],
        })
      ).resolves.toEqual({ created: 0, updated: 2 });
      // the old holder is freed before the statement that reassigns codes
      expect(prisma.catalogItem.updateMany).toHaveBeenCalledWith({
        where: { labTenantId: LAB_A, id: { in: ['i1'] } },
        data: { billingCode: null },
      });
    });
  });
});
