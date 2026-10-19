import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingMappingService } from './billing-mapping.service';

const LAB = 'lab-a';

describe('BillingMappingService', () => {
  let service: BillingMappingService;
  let prisma: {
    catalogItem: {
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
      createMany: jest.Mock;
      findUnique: jest.Mock;
    };
    billingDeletedItemCode: { upsert: jest.Mock; deleteMany: jest.Mock };
    order: { update: jest.Mock; updateMany: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const own = (
    rows: Array<{ id: string; name: string; billingCode?: string | null }>
  ) =>
    prisma.catalogItem.findMany.mockResolvedValue(
      rows.map((r) => ({ billingCode: null, ...r }))
    );

  beforeEach(async () => {
    prisma = {
      catalogItem: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'x' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
        createMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      billingDeletedItemCode: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: { update: jest.fn(), updateMany: jest.fn() },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { name: 'Hemograma', code: 'CBC', lines: 3, orders: 2 },
        ]),
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) =>
          cb(prisma)
        ),
    };
    const module = await Test.createTestingModule({
      providers: [
        BillingMappingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(BillingMappingService);
  });

  describe('suggest', () => {
    it("ranks only this lab's items and saves nothing", async () => {
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 'alb', kind: 'TEST', code: 'ALB', name: 'Albumina', billingCode: null },
      ]);
      const res = await service.suggest(LAB, [
        { code: 'ALB', description: 'Albumina' },
        { code: 'BPCR', description: 'Babesia sp.' },
      ]);
      expect(prisma.catalogItem.findMany.mock.calls[0][0].where).toEqual({
        labTenantId: LAB,
      });
      expect(res.suggestions.map((s) => s.status)).toEqual([
        'SUGGESTED',
        'NO_MATCH',
      ]);
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
      expect(prisma.catalogItem.create).not.toHaveBeenCalled();
      expect(prisma.catalogItem.createMany).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('saves confirmed pairs touching only billingCode', async () => {
      own([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
      const res = await service.apply(
        LAB,
        [
          { catalogItemId: 'a', billingCode: ' AAA ' },
          { catalogItemId: 'b', billingCode: 'BBB' },
        ],
        false,
        'u1'
      );
      expect(res).toEqual({ updated: 2, unchanged: 0 });
      expect(prisma.catalogItem.update.mock.calls.map((c) => c[0].data)).toEqual([
        { billingCode: 'AAA' },
        { billingCode: 'BBB' },
      ]);
    });

    it("rejects an item that is not in this lab's catalog (other lab's id)", async () => {
      own([{ id: 'a', name: 'A' }]);
      await expect(
        service.apply(
          LAB,
          [{ catalogItemId: 'other-labs-item', billingCode: 'X' }],
          false,
          'u1'
        )
      ).rejects.toThrow(BadRequestException);
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
      expect(prisma.catalogItem.findMany.mock.calls[0][0].where).toEqual({
        labTenantId: LAB,
      });
    });

    it('rejects one code assigned to two items in the request', async () => {
      own([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
      await expect(
        service.apply(
          LAB,
          [
            { catalogItemId: 'a', billingCode: 'SDMA' },
            { catalogItemId: 'b', billingCode: 'sdma' },
          ],
          false,
          'u1'
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a code another item already has', async () => {
      own([
        { id: 'a', name: 'A' },
        { id: 'b', name: 'Beta', billingCode: 'TAKEN' },
      ]);
      await expect(
        service.apply(
          LAB,
          [{ catalogItemId: 'a', billingCode: 'taken' }],
          false,
          'u1'
        )
      ).rejects.toThrow(ConflictException);
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
    });

    it('refuses to replace an existing different code unless confirmed', async () => {
      own([{ id: 'a', name: 'A', billingCode: 'OLD' }]);
      const err = await service
        .apply(LAB, [{ catalogItemId: 'a', billingCode: 'NEW' }], false, 'u1')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(
        ((err as ConflictException).getResponse() as { code: string }).code
      ).toBe('BILLING_CODE_REPLACE_NOT_CONFIRMED');
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();

      await service.apply(
        LAB,
        [{ catalogItemId: 'a', billingCode: 'NEW' }],
        true,
        'u1'
      );
      expect(prisma.catalogItem.update).toHaveBeenCalledTimes(1);
    });

    it('re-applying the same code is a no-op', async () => {
      own([{ id: 'a', name: 'A', billingCode: 'SAME' }]);
      const res = await service.apply(
        LAB,
        [{ catalogItemId: 'a', billingCode: 'SAME' }],
        false,
        'u1'
      );
      expect(res).toEqual({ updated: 0, unchanged: 1 });
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
    });

    it('is atomic: runs inside one transaction', async () => {
      own([{ id: 'a', name: 'A' }]);
      await service.apply(
        LAB,
        [{ catalogItemId: 'a', billingCode: 'X' }],
        false,
        'u1'
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('assignDeletedItemCode', () => {
    const user = { id: 'u1', name: 'Ana' };

    it('saves a reviewed code for a deleted item and leaves orders and catalog alone', async () => {
      const res = await service.assignDeletedItemCode(
        LAB,
        'gone-1',
        ' HEM-OLD ',
        user
      );
      expect(res).toEqual({
        catalogItemId: 'gone-1',
        billingCode: 'HEM-OLD',
        itemName: 'Hemograma',
        lineCount: 3,
        orderCount: 2,
      });
      expect(prisma.billingDeletedItemCode.upsert).toHaveBeenCalledTimes(1);
      const arg = prisma.billingDeletedItemCode.upsert.mock.calls[0][0];
      expect(arg.where).toEqual({
        labTenantId_catalogItemId: { labTenantId: LAB, catalogItemId: 'gone-1' },
      });
      expect(arg.create).toMatchObject({
        labTenantId: LAB,
        billingCode: 'HEM-OLD',
        itemName: 'Hemograma',
        internalCode: 'CBC',
        assignedByUserId: 'u1',
      });
      // No catalog item recreated, no order touched
      expect(prisma.catalogItem.create).not.toHaveBeenCalled();
      expect(prisma.catalogItem.createMany).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it("counts only this lab's orders", async () => {
      await service.assignDeletedItemCode(LAB, 'gone-1', 'X', user);
      const values = prisma.$queryRaw.mock.calls[0].slice(1);
      expect(values).toEqual([LAB, 'gone-1']);
    });

    it('refuses an item that still exists in this lab (set it in the catalog)', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: LAB });
      await expect(
        service.assignDeletedItemCode(LAB, 'live', 'X', user)
      ).rejects.toThrow(ConflictException);
      expect(prisma.billingDeletedItemCode.upsert).not.toHaveBeenCalled();
    });

    it("treats another lab's item as not found", async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({ labTenantId: 'lab-b' });
      await expect(
        service.assignDeletedItemCode(LAB, 'theirs', 'X', user)
      ).rejects.toThrow(NotFoundException);
      expect(prisma.billingDeletedItemCode.upsert).not.toHaveBeenCalled();
    });

    it('refuses an id no order of this lab refers to', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await expect(
        service.assignDeletedItemCode(LAB, 'nowhere', 'X', user)
      ).rejects.toThrow(NotFoundException);
      expect(prisma.billingDeletedItemCode.upsert).not.toHaveBeenCalled();
    });

    it('refuses an empty code or one with a line break', async () => {
      await expect(
        service.assignDeletedItemCode(LAB, 'gone-1', '  ', user)
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.assignDeletedItemCode(LAB, 'gone-1', 'A\nB', user)
      ).rejects.toThrow(BadRequestException);
    });

    it('clearing is scoped to this lab and reports a missing code', async () => {
      await service.clearDeletedItemCode(LAB, 'gone-1');
      expect(prisma.billingDeletedItemCode.deleteMany).toHaveBeenCalledWith({
        where: { labTenantId: LAB, catalogItemId: 'gone-1' },
      });
      prisma.billingDeletedItemCode.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        service.clearDeletedItemCode(LAB, 'gone-1')
      ).rejects.toThrow(NotFoundException);
    });
  });
});
