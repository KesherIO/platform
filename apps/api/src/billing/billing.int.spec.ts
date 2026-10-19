/**
 * Billing export and billing-code mapping against a real Postgres: raw SQL
 * (advisory lock, jsonb line lookup), the unique indexes, transaction
 * rollback, and lab isolation are checked on real rows.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set (throwaway database only,
 * see lab/result-entry.batch.int.spec.ts). Rows are scoped to tenants created
 * here and removed afterwards.
 */
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BillingExportService } from './billing-export.service';
import { BillingMappingService } from './billing-mapping.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Billing export against Postgres', () => {
  let prisma: PrismaService;
  let exporter: BillingExportService;
  let mapping: BillingMappingService;
  const runId = randomUUID().slice(0, 8);
  const user = { id: randomUUID(), name: 'Ana Admin' };
  let labA: string;
  let labB: string;
  let clinicA: string;
  let clinicB: string;
  let alt: string; // TEST with billing code
  let pkg: string; // PACKAGE with billing code
  let comp1: string;
  let comp2: string;
  let addOn: string;
  let labBItem: string;

  const DAY = { dateFrom: '2026-10-18', dateTo: '2026-10-18' };
  // Bogotá is UTC-5: 2026-10-18 local = 05:00Z on the 18th → 05:00Z on the 19th
  const at = (iso: string) => new Date(iso);

  type TestSpec = {
    catalogItemId: string;
    status?: string;
    lineKeys: string[];
  };

  async function newOrder(opts: {
    lab: string;
    clinic: string;
    patient: string;
    createdAt: Date;
    status?: string;
    items: Array<{ id: string; kind: 'TEST' | 'PACKAGE'; code: string }>;
    tests?: TestSpec[];
  }) {
    const kase = await prisma.case.create({
      data: {
        tenantId: opts.clinic,
        patientName: opts.patient,
        patientSpecies: 'DOG',
        ownerName: `Owner ${opts.patient}`,
        createdByUserId: user.id,
      },
    });
    const order = await prisma.order.create({
      data: {
        requisitionNumber: `IT-${randomUUID().slice(0, 8)}`,
        caseId: kase.id,
        tenantId: opts.clinic,
        labTenantId: opts.lab,
        createdAt: opts.createdAt,
        status: (opts.status ?? 'PENDING') as never,
        orderedItems: opts.items.map((i) => ({
          catalogItemId: i.id,
          code: i.code,
          name: `${i.code} name`,
          kind: i.kind,
          category: null,
          turnaroundHours: null,
        })),
      },
    });
    for (const t of opts.tests ?? []) {
      const ot = await prisma.orderedTest.create({
        data: {
          orderId: order.id,
          catalogItemId: t.catalogItemId,
          catalogItemName: 'x',
          status: (t.status ?? 'PENDING') as never,
        },
      });
      await prisma.orderedTestSource.createMany({
        data: t.lineKeys.map((k, i) => ({
          orderedTestId: ot.id,
          originCatalogItemId: t.catalogItemId,
          sourceType: 'DIRECT' as const,
          originalOrderItemKey: k,
          originalOrderItemIndex: i,
          originName: 'x',
        })),
      });
    }
    return order;
  }

  const lines = (exportId: string) =>
    prisma.billingExportLine.findMany({
      where: { exportId },
      orderBy: { position: 'asc' },
    });

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    exporter = new BillingExportService(prisma);
    mapping = new BillingMappingService(prisma);

    const mk = (name: string, type: 'LAB' | 'CLINIC', timezone?: string) =>
      prisma.tenant.create({
        data: {
          name: `${name} ${runId}`,
          slug: `it-bill-${name}-${runId}`,
          type,
          ...(timezone && { timezone }),
        },
      });
    labA = (await mk('labA', 'LAB', 'America/Bogota')).id;
    labB = (await mk('labB', 'LAB', 'America/Bogota')).id;
    clinicA = (await mk('clinicA', 'CLINIC')).id;
    clinicB = (await mk('clinicB', 'CLINIC')).id;
    await prisma.user.create({
      data: { id: user.id, email: `it-bill-${runId}@it.example.com` },
    });

    const item = async (
      lab: string,
      kind: 'TEST' | 'PACKAGE',
      code: string,
      billingCode: string | null
    ) =>
      (
        await prisma.catalogItem.create({
          data: {
            labTenantId: lab,
            kind,
            code,
            name: `${code} name`,
            billingCode,
          },
        })
      ).id;
    alt = await item(labA, 'TEST', 'ALT', 'ALT-B');
    comp1 = await item(labA, 'TEST', 'C1', 'C1-B');
    comp2 = await item(labA, 'TEST', 'C2', 'C2-B');
    pkg = await item(labA, 'PACKAGE', 'PREN', 'PERFIL-RENAL');
    addOn = await item(labA, 'TEST', 'SDMA', 'SDMA-B');
    labBItem = await item(labB, 'TEST', 'ALT', 'ALT-B'); // same codes, other lab
  });

  afterAll(async () => {
    // Clinics first: their orders and cases cascade; then labs and the user
    for (const id of [clinicA, clinicB, labA, labB]) {
      await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  describe('what is exported', () => {
    let order: { id: string };

    beforeAll(async () => {
      // pending, nothing accessioned yet
      await newOrder({
        lab: labA,
        clinic: clinicA,
        patient: 'Pending Max',
        createdAt: at('2026-10-18T15:00:00Z'),
        items: [{ id: alt, kind: 'TEST', code: 'ALT' }],
      });
      // completed
      await newOrder({
        lab: labA,
        clinic: clinicA,
        patient: 'Done Luna',
        createdAt: at('2026-10-18T16:00:00Z'),
        status: 'COMPLETED',
        items: [{ id: alt, kind: 'TEST', code: 'ALT' }],
        tests: [
          { catalogItemId: alt, status: 'COMPLETED', lineKeys: ['line-0'] },
        ],
      });
      // package (components are tests) + a later add-on
      order = await newOrder({
        lab: labA,
        clinic: clinicB,
        patient: 'Pkg Rex',
        createdAt: at('2026-10-18T17:00:00Z'),
        items: [
          { id: pkg, kind: 'PACKAGE', code: 'PREN' },
          { id: addOn, kind: 'TEST', code: 'SDMA' },
        ],
        tests: [
          { catalogItemId: comp1, lineKeys: ['line-0'] },
          { catalogItemId: comp2, lineKeys: ['line-0'] },
          { catalogItemId: addOn, lineKeys: ['line-1'] },
        ],
      });
      // cancelled order, and an order with one cancelled test
      await newOrder({
        lab: labA,
        clinic: clinicA,
        patient: 'Cancelled Order',
        createdAt: at('2026-10-18T18:00:00Z'),
        status: 'CANCELLED',
        items: [{ id: alt, kind: 'TEST', code: 'ALT' }],
      });
      await newOrder({
        lab: labA,
        clinic: clinicA,
        patient: 'Cancelled Test',
        createdAt: at('2026-10-18T19:00:00Z'),
        items: [
          { id: alt, kind: 'TEST', code: 'ALT' },
          { id: addOn, kind: 'TEST', code: 'SDMA' },
        ],
        tests: [
          { catalogItemId: alt, status: 'CANCELLED', lineKeys: ['line-0'] },
          { catalogItemId: addOn, lineKeys: ['line-1'] },
        ],
      });
      // Boundaries (Bogotá): last ms of the 18th is in, first ms of the 19th is out
      await newOrder({
        lab: labA,
        clinic: clinicA,
        patient: 'Edge In',
        createdAt: at('2026-10-19T04:59:59.999Z'),
        items: [{ id: alt, kind: 'TEST', code: 'ALT' }],
      });
      await newOrder({
        lab: labA,
        clinic: clinicA,
        patient: 'Edge Out',
        createdAt: at('2026-10-19T05:00:00.000Z'),
        items: [{ id: alt, kind: 'TEST', code: 'ALT' }],
      });
      await newOrder({
        lab: labA,
        clinic: clinicA,
        patient: 'Edge Before',
        createdAt: at('2026-10-18T04:59:59.999Z'),
        items: [{ id: alt, kind: 'TEST', code: 'ALT' }],
      });
    });

    it('exports pending and completed orders, a package once, add-ons separately, skipping cancellations, inside the lab-local day', async () => {
      const res = await exporter.generate(labA, user, DAY);
      const byPatient = (p: string) =>
        res.rows.filter((r) => r.patientName === p).map((r) => r.item);

      expect(byPatient('Pending Max')).toEqual(['ALT-B']);
      expect(byPatient('Done Luna')).toEqual(['ALT-B']);
      expect(byPatient('Pkg Rex')).toEqual(['PERFIL-RENAL', 'SDMA-B']);
      expect(byPatient('Cancelled Order')).toEqual([]);
      expect(byPatient('Cancelled Test')).toEqual(['SDMA-B']);
      expect(byPatient('Edge In')).toEqual(['ALT-B']);
      expect(byPatient('Edge Out')).toEqual([]);
      expect(byPatient('Edge Before')).toEqual([]);
      expect(res.rows.some((r) => ['C1-B', 'C2-B'].includes(r.item))).toBe(
        false
      );
      // fecha: creation day in the lab's zone ("Edge In" is 23:59 local on the 18th)
      expect(new Set(res.rows.map((r) => r.fecha))).toEqual(
        new Set(['2026-10-18'])
      );
      expect(res.rows.find((r) => r.patientName === 'Pkg Rex')?.entidad).toBe(
        `clinicB ${runId}`
      );
    });

    it('the stored lines are exactly the rows returned', async () => {
      const res = await exporter.generate(labA, user, DAY);
      const stored = await lines(res.exportId);
      expect(
        stored.map((l) => ({
          fecha: l.fecha,
          entidad: l.entidad,
          item: l.item,
          cantidad: l.cantidad,
          patientName: l.patientName,
        }))
      ).toEqual(res.rows);
      const again = await exporter.get(labA, res.exportId);
      expect(again.rows).toEqual(res.rows);
    });

    it('an amendment-style change (test status moving on) never adds a charge', async () => {
      const before = await exporter.preview(labA, DAY.dateFrom, DAY.dateTo);
      await prisma.orderedTest.updateMany({
        where: { orderId: order.id },
        data: { status: 'COMPLETED', version: 2 },
      });
      const after = await exporter.preview(labA, DAY.dateFrom, DAY.dateTo);
      expect(after.summary.lines).toBe(before.summary.lines);
    });

    it('cancelling after an export is reported, and the old file is unchanged', async () => {
      const first = await exporter.generate(labA, user, DAY);
      const victim = await prisma.order.findFirstOrThrow({
        where: { labTenantId: labA, case: { patientName: 'Pending Max' } },
      });
      await prisma.order.update({
        where: { id: victim.id },
        data: { status: 'CANCELLED' },
      });
      try {
        const preview = await exporter.preview(labA, DAY.dateFrom, DAY.dateTo);
        expect(preview.withdrawnSinceExport).toEqual([
          expect.objectContaining({
            orderId: victim.id,
            reason: 'ORDER_CANCELLED',
          }),
        ]);
        expect((await exporter.get(labA, first.exportId)).rows).toEqual(
          first.rows
        );
      } finally {
        await prisma.order.update({
          where: { id: victim.id },
          data: { status: 'PENDING' },
        });
      }
    });
  });

  describe('lab isolation', () => {
    it("lab B sees none of lab A's orders, exports or codes", async () => {
      const exportA = await exporter.generate(labA, user, DAY);

      const previewB = await exporter.preview(labB, DAY.dateFrom, DAY.dateTo);
      expect(previewB.summary.orders).toBe(0);
      await expect(exporter.generate(labB, user, DAY)).rejects.toMatchObject({
        response: { code: 'NOTHING_TO_EXPORT' },
      });
      await expect(exporter.get(labB, exportA.exportId)).rejects.toThrow(
        /not found/i
      );
      expect((await exporter.list(labB)).data).toEqual([]);
      expect((await exporter.list(labA)).data.map((e) => e.id)).toContain(
        exportA.exportId
      );
    });

    it("another lab's catalog item is never used to code my order lines", async () => {
      const order = await newOrder({
        lab: labA,
        clinic: clinicA,
        patient: 'Foreign Item',
        createdAt: at('2026-10-20T15:00:00Z'),
        items: [{ id: labBItem, kind: 'TEST', code: 'ALT' }],
      });
      const p = await exporter.preview(labA, '2026-10-20', '2026-10-20');
      expect(p.missingCodes).toEqual([
        expect.objectContaining({
          catalogItemId: labBItem,
          reason: 'ITEM_NOT_IN_CATALOG',
        }),
      ]);
      await expect(
        exporter.generate(labA, user, {
          dateFrom: '2026-10-20',
          dateTo: '2026-10-20',
        })
      ).rejects.toMatchObject({ response: { code: 'MISSING_BILLING_CODES' } });
      // nor can lab A attach a code to lab B's live item
      await expect(
        mapping.assignDeletedItemCode(labA, labBItem, 'X', user)
      ).rejects.toThrow(/No order of this laboratory/);
      await prisma.order.delete({ where: { id: order.id } });
    });

    it("mapping apply refuses another lab's catalog item", async () => {
      await expect(
        mapping.apply(
          labA,
          [{ catalogItemId: labBItem, billingCode: 'HACK' }],
          false,
          user.id
        )
      ).rejects.toThrow(/not found in this lab/);
      const untouched = await prisma.catalogItem.findUniqueOrThrow({
        where: { id: labBItem },
      });
      expect(untouched.billingCode).toBe('ALT-B');
    });
  });

  describe('atomic history', () => {
    const range = { dateFrom: '2026-10-22', dateTo: '2026-10-22' };

    beforeAll(async () => {
      for (const p of ['A1', 'A2', 'A3']) {
        await newOrder({
          lab: labA,
          clinic: clinicA,
          patient: `Atomic ${p}`,
          createdAt: at('2026-10-22T15:00:00Z'),
          items: [{ id: alt, kind: 'TEST', code: 'ALT' }],
        });
      }
    });

    it('a failure while saving the lines rolls the whole export back', async () => {
      const failing = prisma.$extends({
        query: {
          billingExportLine: {
            createMany() {
              throw new Error('disk full (simulated)');
            },
          },
        },
      });
      const broken = new BillingExportService(failing as never);
      const before = await prisma.billingExport.count({
        where: { labTenantId: labA },
      });

      await expect(broken.generate(labA, user, range)).rejects.toThrow(
        'disk full (simulated)'
      );

      // No export row without its lines, no lines without an export
      expect(
        await prisma.billingExport.count({ where: { labTenantId: labA } })
      ).toBe(before);
      const history = await exporter.preview(
        labA,
        range.dateFrom,
        range.dateTo
      );
      expect(history.summary.alreadyExported).toBe(0);
    });

    it('a failing generation does not block the next one (lock released with the transaction)', async () => {
      const res = await exporter.generate(labA, user, range);
      expect(res.rows).toHaveLength(3);
      expect(await lines(res.exportId)).toHaveLength(3);
    });

    it('every recorded export has exactly lineCount lines', async () => {
      const exports = await prisma.billingExport.findMany({
        where: { labTenantId: labA },
        include: { _count: { select: { lines: true } } },
      });
      expect(exports.length).toBeGreaterThan(0);
      for (const e of exports) expect(e._count.lines).toBe(e.lineCount);
    });

    it('large files are saved: Prisma batches past the bind-parameter limit', async () => {
      const exp = await prisma.billingExport.create({
        data: {
          labTenantId: labB,
          createdByUserId: user.id,
          createdByName: user.name,
          dateFrom: '2026-01-01',
          dateTo: '2026-01-01',
          timezone: 'UTC',
          lineCount: 12_000,
        },
      });
      await prisma.billingExportLine.createMany({
        data: Array.from({ length: 12_000 }, (_, i) => ({
          exportId: exp.id,
          orderId: `o-${i}`,
          lineKey: 'line-0',
          catalogItemId: 'x',
          fecha: '2026-01-01',
          entidad: 'E',
          item: 'I',
          cantidad: 1,
          patientName: 'P',
          position: i,
        })),
      });
      expect(
        await prisma.billingExportLine.count({ where: { exportId: exp.id } })
      ).toBe(12_000);
    });
  });

  describe('concurrent generation', () => {
    const range = { dateFrom: '2026-10-24', dateTo: '2026-10-24' };

    beforeAll(async () => {
      for (const p of ['C1', 'C2', 'C3', 'C4']) {
        await newOrder({
          lab: labA,
          clinic: clinicA,
          patient: `Concurrent ${p}`,
          createdAt: at('2026-10-24T15:00:00Z'),
          items: [
            { id: alt, kind: 'TEST', code: 'ALT' },
            { id: addOn, kind: 'TEST', code: 'SDMA' },
          ],
        });
      }
    });

    it('"only new" requests at the same time never overlap: one gets the lines, the rest get nothing', async () => {
      const results = await Promise.allSettled(
        [1, 2, 3, 4].map(() =>
          exporter.generate(labA, user, { ...range, onlyNew: true })
        )
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(3);
      for (const f of failed) {
        expect((f as PromiseRejectedResult).reason.response.code).toBe(
          'NOTHING_TO_EXPORT'
        );
      }

      // No order line appears in more than one export
      const all = await prisma.billingExportLine.findMany({
        where: {
          export: { labTenantId: labA, dateFrom: range.dateFrom },
        },
        select: { orderId: true, lineKey: true },
      });
      expect(all).toHaveLength(8);
      expect(new Set(all.map((l) => `${l.orderId}:${l.lineKey}`)).size).toBe(8);
    });

    it('without "only new", simultaneous requests each get every line (nothing hidden) and are marked as repeats', async () => {
      const [a, b] = await Promise.all([
        exporter.generate(labA, user, range),
        exporter.generate(labA, user, range),
      ]);
      expect(a.rows).toHaveLength(8);
      expect(b.rows).toHaveLength(8);
      const preview = await exporter.preview(
        labA,
        range.dateFrom,
        range.dateTo
      );
      expect(preview.summary.alreadyExported).toBe(8);
    });

    it('different labs do not wait for each other', async () => {
      await newOrder({
        lab: labB,
        clinic: clinicB,
        patient: 'Lab B only',
        createdAt: at('2026-10-24T15:00:00Z'),
        items: [{ id: labBItem, kind: 'TEST', code: 'ALT' }],
      });
      const [a, b] = await Promise.all([
        exporter
          .generate(labA, user, { ...range, onlyNew: true })
          .catch((e) => e),
        exporter.generate(labB, user, range),
      ]);
      expect(b.rows.map((r) => r.patientName)).toEqual(['Lab B only']);
      expect(a).toBeDefined();
    });
  });

  describe('order lines whose catalog item was deleted', () => {
    const range = { dateFrom: '2026-10-26', dateTo: '2026-10-26' };
    const goneId = `deleted-${runId}`;
    let orderId: string;

    beforeAll(async () => {
      const order = await newOrder({
        lab: labA,
        clinic: clinicA,
        patient: 'Orphan Line',
        createdAt: at('2026-10-26T15:00:00Z'),
        items: [{ id: goneId, kind: 'TEST', code: 'HEM-OLD' }],
      });
      orderId = order.id;
    });

    it('blocks the export and never substitutes the internal code', async () => {
      const p = await exporter.preview(labA, range.dateFrom, range.dateTo);
      expect(p.missingCodes).toEqual([
        expect.objectContaining({
          catalogItemId: goneId,
          internalCode: 'HEM-OLD',
          reason: 'ITEM_NOT_IN_CATALOG',
        }),
      ]);
      await expect(exporter.generate(labA, user, range)).rejects.toMatchObject({
        response: { code: 'MISSING_BILLING_CODES' },
      });
    });

    it('a reviewed code resolves it; the order and its snapshot are untouched', async () => {
      const orderBefore = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      const catalogCountBefore = await prisma.catalogItem.count({
        where: { labTenantId: labA },
      });

      const res = await mapping.assignDeletedItemCode(
        labA,
        goneId,
        ' HEM-LAB ',
        user
      );
      expect(res).toMatchObject({
        billingCode: 'HEM-LAB',
        lineCount: 1,
        orderCount: 1,
      });

      const gen = await exporter.generate(labA, user, range);
      expect(gen.rows).toEqual([
        expect.objectContaining({
          item: 'HEM-LAB',
          patientName: 'Orphan Line',
        }),
      ]);

      expect(
        await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
      ).toEqual(orderBefore);
      expect(
        await prisma.catalogItem.count({ where: { labTenantId: labA } })
      ).toBe(catalogCountBefore);
    });

    it('changing the code later affects new files only; the frozen file stays', async () => {
      const first = await exporter.generate(labA, user, range);
      await mapping.assignDeletedItemCode(labA, goneId, 'HEM-LAB-2', user);
      const second = await exporter.generate(labA, user, range);
      expect(first.rows[0].item).toBe('HEM-LAB');
      expect(second.rows[0].item).toBe('HEM-LAB-2');
      expect((await exporter.get(labA, first.exportId)).rows[0].item).toBe(
        'HEM-LAB'
      );
    });

    it("another lab's orders are unaffected by this lab's code", async () => {
      await newOrder({
        lab: labB,
        clinic: clinicB,
        patient: 'Same Dead Id, Lab B',
        createdAt: at('2026-10-26T15:00:00Z'),
        items: [{ id: goneId, kind: 'TEST', code: 'HEM-OLD' }],
      });
      const p = await exporter.preview(labB, range.dateFrom, range.dateTo);
      expect(p.missingCodes).toHaveLength(1);
      expect(p.canGenerate).toBe(false);
    });

    it('clearing the code blocks the export again', async () => {
      await mapping.clearDeletedItemCode(labA, goneId);
      const p = await exporter.preview(labA, range.dateFrom, range.dateTo);
      expect(p.canGenerate).toBe(false);
    });

    it('refuses a live item of this lab, and an id no order uses', async () => {
      await expect(
        mapping.assignDeletedItemCode(labA, alt, 'X', user)
      ).rejects.toMatchObject({ response: { code: 'ITEM_STILL_IN_CATALOG' } });
      await expect(
        mapping.assignDeletedItemCode(labA, `nope-${runId}`, 'X', user)
      ).rejects.toThrow(/No order of this laboratory/);
    });
  });

  describe('billing code uniqueness (awaiting Biomet confirmation)', () => {
    it('the database enforces one code per lab, not across labs', async () => {
      await expect(
        prisma.catalogItem.create({
          data: {
            labTenantId: labA,
            kind: 'TEST',
            name: 'Dup',
            billingCode: 'ALT-B',
          },
        })
      ).rejects.toMatchObject({ code: 'P2002' });
      // lab B already uses ALT-B for its own item
      expect(
        await prisma.catalogItem.count({ where: { billingCode: 'ALT-B' } })
      ).toBeGreaterThanOrEqual(2);
    });

    it('several unmapped items (null) do not collide', async () => {
      const a = await prisma.catalogItem.create({
        data: { labTenantId: labA, kind: 'TEST', name: 'Null 1' },
      });
      const b = await prisma.catalogItem.create({
        data: { labTenantId: labA, kind: 'TEST', name: 'Null 2' },
      });
      expect([a.billingCode, b.billingCode]).toEqual([null, null]);
    });
  });
});
