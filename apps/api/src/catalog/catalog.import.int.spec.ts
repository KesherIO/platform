/**
 * Catalog import against a real Postgres: the batched create/update (raw
 * UPDATE … FROM VALUES with enum casts) and package wiring, using the real
 * platform catalog (src/assets/catalog.json).
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set (throwaway database only,
 * see lab/result-entry.batch.int.spec.ts).
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Catalog import against Postgres', () => {
  let prisma: PrismaService;
  let service: CatalogService;
  let labId: string;
  const platform = JSON.parse(
    // The service reads it from next to the built bundle (dist/assets)
    readFileSync(join(__dirname, '..', 'assets', 'catalog.json'), 'utf-8')
  ) as {
    items: {
      kind: string;
      code?: string;
      name: string;
      componentCodes?: string[];
    }[];
  };
  // A key listed twice in one import updates the first row
  const uniqueItems = new Set(
    platform.items.map((i) => (i.code ? `c:${i.code}` : `n:${i.name}`))
  ).size;
  const importPlatform = () =>
    service.import({
      labTenantId: labId,
      items: platform.items as never,
      replace: false,
    });

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    service = new CatalogService(prisma);
  });

  beforeEach(async () => {
    labId = (
      await prisma.tenant.create({
        data: {
          name: 'IT catalog',
          slug: `it-catalog-${randomUUID()}`,
          type: 'LAB',
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.tenant.delete({ where: { id: labId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const items = () =>
    prisma.catalogItem.findMany({ where: { labTenantId: labId } });

  it('imports the platform catalog, then re-imports it as updates', async () => {
    const first = await importPlatform();
    expect(first).toEqual({
      created: uniqueItems,
      updated: platform.items.length - uniqueItems,
    });
    expect(await items()).toHaveLength(uniqueItems);

    const packages = platform.items.filter((i) => i.kind === 'PACKAGE');
    const wired = await prisma.catalogItemComposition.count({
      where: { package: { labTenantId: labId } },
    });
    expect(wired).toBe(
      packages.reduce((n, p) => n + new Set(p.componentCodes ?? []).size, 0)
    );

    const second = await importPlatform();
    expect(second).toMatchObject({
      created: 0,
      updated: platform.items.length,
    });
    expect(await items()).toHaveLength(uniqueItems);
  });

  it('updates fields and enums of existing items', async () => {
    await service.import({
      labTenantId: labId,
      items: [
        {
          kind: 'TEST' as never,
          name: 'Glucosa',
          code: 'IT-GLU',
          resultType: 'NUMERIC' as never,
          unit: 'mg/dL',
          turnaroundHours: 24,
        },
      ],
    });

    const res = await service.import({
      labTenantId: labId,
      items: [
        {
          kind: 'TEST' as never,
          name: 'Glucosa sérica',
          code: 'IT-GLU',
          resultType: 'TEXT' as never,
          unit: null as never,
          turnaroundHours: 48,
        },
      ],
    });

    expect(res).toEqual({ created: 0, updated: 1 });
    const [item] = await items();
    expect(item).toMatchObject({
      name: 'Glucosa sérica',
      resultType: 'TEXT',
      unit: null,
      turnaroundHours: 48,
    });
  });

  it('a missing package component writes nothing', async () => {
    await expect(
      service.import({
        labTenantId: labId,
        items: [
          { kind: 'TEST' as never, name: 'A', code: 'IT-A' },
          {
            kind: 'PACKAGE' as never,
            name: 'P',
            code: 'IT-P',
            componentCodes: ['IT-A', 'IT-NOPE'],
          },
        ],
      })
    ).rejects.toThrow('IT-NOPE');
    expect(await items()).toHaveLength(0);
  });

  describe('replace:true', () => {
    it('is refused and leaves the catalog, billing codes and package wiring untouched', async () => {
      await service.import({
        labTenantId: labId,
        items: [
          {
            kind: 'TEST' as never,
            name: 'A',
            code: 'IT-A',
            billingCode: 'BILL-A',
          },
          {
            kind: 'PACKAGE' as never,
            name: 'P',
            code: 'IT-P',
            billingCode: 'BILL-P',
            componentCodes: ['IT-A'],
          },
        ],
      });
      const before = await prisma.catalogItem.findMany({
        where: { labTenantId: labId },
        orderBy: { code: 'asc' },
      });

      await expect(
        service.import({
          labTenantId: labId,
          replace: true,
          items: [{ kind: 'TEST' as never, name: 'Other', code: 'IT-O' }],
        })
      ).rejects.toMatchObject({
        response: { code: 'CATALOG_REPLACE_UNSUPPORTED' },
      });

      const after = await prisma.catalogItem.findMany({
        where: { labTenantId: labId },
        orderBy: { code: 'asc' },
      });
      // Same rows, same ids, same billing codes, nothing new
      expect(after).toEqual(before);
      expect(after.map((i) => i.billingCode)).toEqual(['BILL-A', 'BILL-P']);
      expect(
        await prisma.catalogItemComposition.count({
          where: { package: { labTenantId: labId } },
        })
      ).toBe(1);
    });

    it('a normal import never deletes items missing from the file', async () => {
      await service.import({
        labTenantId: labId,
        items: [
          { kind: 'TEST' as never, name: 'A', code: 'IT-A' },
          { kind: 'TEST' as never, name: 'B', code: 'IT-B' },
        ],
      });
      await service.import({
        labTenantId: labId,
        items: [{ kind: 'TEST' as never, name: 'A', code: 'IT-A' }],
      });
      expect(await items()).toHaveLength(2);
    });
  });

  describe('billing codes (real unique index and UPDATE … COALESCE)', () => {
    const row = (code: string, billingCode?: string) => ({
      kind: 'TEST' as never,
      name: `Test ${code}`,
      code,
      billingCode,
    });
    const codes = async () =>
      Object.fromEntries((await items()).map((i) => [i.code, i.billingCode]));

    it('keeps an existing billing code when a re-import leaves it out', async () => {
      await service.import({
        labTenantId: labId,
        items: [row('IT-A', 'BILL-A')],
      });
      await service.import({ labTenantId: labId, items: [row('IT-A')] });
      expect(await codes()).toEqual({ 'IT-A': 'BILL-A' });
    });

    it('moves a code from one existing item to another in one import', async () => {
      await service.import({
        labTenantId: labId,
        items: [row('IT-A', 'X'), row('IT-B')],
      });
      await service.import({
        labTenantId: labId,
        items: [row('IT-A', 'Y'), row('IT-B', 'X')],
      });
      expect(await codes()).toEqual({ 'IT-A': 'Y', 'IT-B': 'X' });
    });

    it('rejects two items with one code, writing nothing', async () => {
      await expect(
        service.import({
          labTenantId: labId,
          items: [row('IT-A', 'DUP'), row('IT-B', 'dup')],
        })
      ).rejects.toThrow(/more than one catalog item/);
      expect(await items()).toHaveLength(0);
    });

    it('the same code in two different labs is fine (unique per lab)', async () => {
      const other = (
        await prisma.tenant.create({
          data: {
            name: 'IT other lab',
            slug: `it-catalog-${randomUUID()}`,
            type: 'LAB',
          },
        })
      ).id;
      try {
        await service.import({
          labTenantId: labId,
          items: [row('IT-A', 'SAME')],
        });
        await service.import({
          labTenantId: other,
          items: [row('IT-A', 'SAME')],
        });
        expect(
          await prisma.catalogItem.count({ where: { billingCode: 'SAME' } })
        ).toBe(2);
      } finally {
        await prisma.tenant.delete({ where: { id: other } });
      }
    });
  });
});
