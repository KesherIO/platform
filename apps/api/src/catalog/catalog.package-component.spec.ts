import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';

const LAB_A = 'lab-a';

const RAW = {
  id: 'item1',
  labTenantId: LAB_A,
  kind: 'TEST',
  code: 'COPRO1',
  billingCode: null,
  packageComponentOnly: true,
  name: 'Copro mx 1',
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

describe('CatalogService — package component only', () => {
  let service: CatalogService;
  let prisma: {
    clinicLabConnection: { findFirst: jest.Mock };
    catalogItem: Record<string, jest.Mock>;
    catalogItemComposition: Record<string, jest.Mock>;
    caseCatalogItem: { count: jest.Mock };
    orderedTest: { count: jest.Mock };
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
          .mockResolvedValue({
            labTenantId: LAB_A,
            code: 'COPRO1',
            kind: 'TEST',
          }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(RAW),
        update: jest.fn().mockResolvedValue(RAW),
      },
      catalogItemComposition: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      caseCatalogItem: { count: jest.fn().mockResolvedValue(0) },
      orderedTest: { count: jest.fn().mockResolvedValue(0) },
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

  describe('clinic catalog (GET /catalog, also what the AI triage sees)', () => {
    it('asks only for tests that are not package-only', async () => {
      await service.findAll('clinic-1');
      expect(prisma.catalogItem.findMany.mock.calls[0][0].where).toEqual({
        labTenantId: LAB_A,
        active: true,
        packageComponentOnly: false,
      });
    });

    it('never tells a clinic about the flag', async () => {
      const [item] = await service.findAll('clinic-1');
      expect(item).not.toHaveProperty('packageComponentOnly');
    });
  });

  describe("the lab's own catalog", () => {
    it('is not filtered and shows the flag', async () => {
      const res = await service.findAllAdmin(LAB_A, {});
      expect(prisma.catalogItem.findMany.mock.calls[0][0].where).toEqual({
        labTenantId: LAB_A,
      });
      expect(res.data[0].packageComponentOnly).toBe(true);
    });
  });

  describe('createItem', () => {
    it('saves the flag on a test', async () => {
      await service.createItem(LAB_A, {
        kind: 'TEST',
        name: 'Copro mx 1',
        packageComponentOnly: true,
      } as never);
      expect(
        prisma.catalogItem.create.mock.calls[0][0].data.packageComponentOnly
      ).toBe(true);
    });

    it('defaults to visible', async () => {
      await service.createItem(LAB_A, { kind: 'TEST', name: 'X' } as never);
      expect(
        prisma.catalogItem.create.mock.calls[0][0].data.packageComponentOnly
      ).toBe(false);
    });

    it('refuses the flag on a package', async () => {
      await expect(
        service.createItem(LAB_A, {
          kind: 'PACKAGE',
          name: 'Seriado',
          packageComponentOnly: true,
        } as never)
      ).rejects.toThrow(BadRequestException);
      expect(prisma.catalogItem.create).not.toHaveBeenCalled();
    });
  });

  describe('updateItem', () => {
    it('toggles the flag and nothing else', async () => {
      await service.updateItem(LAB_A, 'item1', { packageComponentOnly: false });
      expect(prisma.catalogItem.update.mock.calls[0][0].data).toEqual({
        packageComponentOnly: false,
      });
    });

    it('leaves it alone when not sent', async () => {
      await service.updateItem(LAB_A, 'item1', { name: 'Nuevo' });
      expect(prisma.catalogItem.update.mock.calls[0][0].data).toEqual({
        name: 'Nuevo',
      });
    });

    it('refuses to set it on a package', async () => {
      prisma.catalogItem.findUnique.mockResolvedValue({
        labTenantId: LAB_A,
        code: 'PKG',
        kind: 'PACKAGE',
      });
      await expect(
        service.updateItem(LAB_A, 'pkg1', { packageComponentOnly: true })
      ).rejects.toThrow(BadRequestException);
      expect(prisma.catalogItem.update).not.toHaveBeenCalled();
    });
  });
});
