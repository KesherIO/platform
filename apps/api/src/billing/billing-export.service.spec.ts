import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingExportService } from './billing-export.service';

const LAB = 'lab-a';
const USER = { id: 'u1', name: 'Ana Admin' };

const orderedItem = (id: string, kind: 'TEST' | 'PACKAGE', code: string) => ({
  catalogItemId: id,
  code,
  name: `${code} name`,
  kind,
  category: null,
  turnaroundHours: null,
});

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  requisitionNumber: 'REQ-1',
  status: 'PENDING',
  createdAt: new Date('2026-10-18T15:00:00Z'),
  orderedItems: [orderedItem('t1', 'TEST', 'ALT')],
  tenant: { name: 'Clínica Ñandú' },
  case: { patientName: 'Max' },
  orderedTests: [],
  ...over,
});

describe('BillingExportService', () => {
  let service: BillingExportService;
  let prisma: {
    tenant: { findUnique: jest.Mock };
    order: { findMany: jest.Mock };
    catalogItem: { findMany: jest.Mock };
    billingExport: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
    billingExportLine: { findMany: jest.Mock; createMany: jest.Mock };
    billingDeletedItemCode: { findMany: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'America/Bogota' }),
      },
      order: { findMany: jest.fn().mockResolvedValue([orderRow()]) },
      catalogItem: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 't1', billingCode: 'ALT-B' }]),
      },
      billingExport: {
        create: jest.fn().mockResolvedValue({
          id: 'exp1',
          createdAt: new Date('2026-10-19T12:00:00Z'),
        }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      billingExportLine: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      billingDeletedItemCode: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) =>
          cb(prisma)
        ),
    };
    const module = await Test.createTestingModule({
      providers: [
        BillingExportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(BillingExportService);
  });

  describe('range and scope', () => {
    it('queries only this lab, with the range as lab-local days, no status filter', async () => {
      await service.preview(LAB, '2026-10-18', '2026-10-18');
      const where = prisma.order.findMany.mock.calls[0][0].where;
      expect(where.labTenantId).toBe(LAB);
      expect(where).not.toHaveProperty('status');
      // Bogotá is UTC-5: the 18th local = 05:00Z on the 18th → 05:00Z on the 19th
      expect(where.createdAt.gte.toISOString()).toBe('2026-10-18T05:00:00.000Z');
      expect(where.createdAt.lt.toISOString()).toBe('2026-10-19T05:00:00.000Z');
    });

    it("resolves billing codes and past exports within this lab's data only", async () => {
      await service.preview(LAB, '2026-10-18', '2026-10-18');
      expect(prisma.catalogItem.findMany.mock.calls[0][0].where).toMatchObject({
        labTenantId: LAB,
      });
      expect(
        prisma.billingExportLine.findMany.mock.calls[0][0].where.export
      ).toEqual({ labTenantId: LAB });
    });

    it('falls back to UTC for a lab without a valid timezone', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ timezone: 'Nope/Zone' });
      const p = await service.preview(LAB, '2026-10-18', '2026-10-18');
      expect(p.timezone).toBe('UTC');
    });

    it.each([
      ['2026-10-19', '2026-10-18'],
      ['2026-02-30', '2026-03-01'],
      ['2025-01-01', '2026-10-18'],
    ])('rejects range %s → %s', async (from, to) => {
      await expect(service.preview(LAB, from, to)).rejects.toThrow(
        BadRequestException
      );
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('fecha is the order creation day in the lab timezone, not the UTC day', async () => {
      // 22:30 Bogotá on the 18th = 03:30Z on the 19th
      prisma.order.findMany.mockResolvedValue([
        orderRow({ createdAt: new Date('2026-10-19T03:30:00Z') }),
      ]);
      const res = await service.generate(LAB, USER, {
        dateFrom: '2026-10-18',
        dateTo: '2026-10-18',
      });
      expect(res.rows[0].fecha).toBe('2026-10-18');
    });

    it('fecha is the creation date even when the order is completed later', async () => {
      prisma.order.findMany.mockResolvedValue([
        orderRow({
          status: 'COMPLETED',
          completedAt: new Date('2026-10-25T10:00:00Z'),
        }),
      ]);
      const res = await service.generate(LAB, USER, {
        dateFrom: '2026-10-18',
        dateTo: '2026-10-18',
      });
      expect(res.rows[0].fecha).toBe('2026-10-18');
    });
  });

  describe('generate', () => {
    const range = { dateFrom: '2026-10-18', dateTo: '2026-10-18' };

    it('returns exactly the five columns, in order, with the billing code as item', async () => {
      const res = await service.generate(LAB, USER, range);
      expect(res.columns.map((c) => c.header)).toEqual([
        'fecha',
        'entidad',
        'item',
        'cantidad',
        'nombre del paciente',
      ]);
      expect(res.rows).toEqual([
        {
          fecha: '2026-10-18',
          entidad: 'Clínica Ñandú',
          item: 'ALT-B',
          cantidad: 1,
          patientName: 'Max',
        },
      ]);
    });

    it('pending and completed orders are both included', async () => {
      prisma.order.findMany.mockResolvedValue([
        orderRow({ id: 'a', status: 'PENDING' }),
        orderRow({ id: 'b', status: 'COMPLETED' }),
      ]);
      const res = await service.generate(LAB, USER, range);
      expect(res.rows).toHaveLength(2);
    });

    it('charges a package once with the package code, not its components', async () => {
      prisma.order.findMany.mockResolvedValue([
        orderRow({
          orderedItems: [orderedItem('pkg', 'PACKAGE', 'PREN')],
          orderedTests: ['c1', 'c2', 'c3'].map((id) => ({
            catalogItemId: id,
            status: 'READY',
            sources: [{ originalOrderItemKey: 'line-0' }],
          })),
        }),
      ]);
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 'pkg', billingCode: 'PERFIL-RENAL' },
      ]);
      const res = await service.generate(LAB, USER, range);
      expect(res.rows.map((r) => r.item)).toEqual(['PERFIL-RENAL']);
    });

    it('a standalone add-on is a separate row next to the package', async () => {
      prisma.order.findMany.mockResolvedValue([
        orderRow({
          orderedItems: [
            orderedItem('pkg', 'PACKAGE', 'PREN'),
            orderedItem('t1', 'TEST', 'SDMA'),
          ],
        }),
      ]);
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 'pkg', billingCode: 'PERFIL-RENAL' },
        { id: 't1', billingCode: 'SDMA-B' },
      ]);
      const res = await service.generate(LAB, USER, range);
      expect(res.rows.map((r) => r.item)).toEqual(['PERFIL-RENAL', 'SDMA-B']);
    });

    it('skips cancelled orders and cancelled items', async () => {
      prisma.order.findMany.mockResolvedValue([
        orderRow({ id: 'x', status: 'CANCELLED' }),
        orderRow({
          id: 'y',
          orderedItems: [
            orderedItem('t1', 'TEST', 'ALT'),
            orderedItem('t2', 'TEST', 'AST'),
          ],
          orderedTests: [
            {
              catalogItemId: 't1',
              status: 'CANCELLED',
              sources: [{ originalOrderItemKey: 'line-0' }],
            },
            {
              catalogItemId: 't2',
              status: 'PENDING',
              sources: [{ originalOrderItemKey: 'line-1' }],
            },
          ],
        }),
      ]);
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 't1', billingCode: 'A' },
        { id: 't2', billingCode: 'B' },
      ]);
      const res = await service.generate(LAB, USER, range);
      expect(res.rows.map((r) => r.item)).toEqual(['B']);
    });

    it('refuses to generate while any service has no billing code, and lists them', async () => {
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 't1', billingCode: null },
      ]);
      const err = await service
        .generate(LAB, USER, range)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as {
        code: string;
        missingCodes: Array<Record<string, unknown>>;
      };
      expect(body.code).toBe('MISSING_BILLING_CODES');
      expect(body.missingCodes).toEqual([
        expect.objectContaining({
          catalogItemId: 't1',
          internalCode: 'ALT',
          reason: 'NO_BILLING_CODE',
          lineCount: 1,
        }),
      ]);
      expect(prisma.billingExport.create).not.toHaveBeenCalled();
    });

    it('never substitutes the internal code for a missing billing code', async () => {
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 't1', billingCode: null },
      ]);
      await expect(service.generate(LAB, USER, range)).rejects.toThrow();
      const p = await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(p.lines[0].item).toBeNull();
      expect(p.canGenerate).toBe(false);
    });

    it("an item from another lab's catalog counts as missing, not as mapped", async () => {
      // the order line points at an id this lab's catalog query does not return
      prisma.catalogItem.findMany.mockResolvedValue([]);
      const p = await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(p.missingCodes[0]).toMatchObject({
        reason: 'ITEM_NOT_IN_CATALOG',
      });
    });

    it('a reviewed code for a deleted item resolves its lines — never the internal code', async () => {
      prisma.catalogItem.findMany.mockResolvedValue([]);
      prisma.billingDeletedItemCode.findMany.mockResolvedValue([
        { catalogItemId: 't1', billingCode: 'REVIEWED-1' },
      ]);
      const p = await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(p.missingCodes).toEqual([]);
      expect(p.lines[0]).toMatchObject({
        item: 'REVIEWED-1',
        codeSource: 'DELETED_ITEM',
        missing: null,
      });
      const res = await service.generate(LAB, USER, range);
      expect(res.rows[0].item).toBe('REVIEWED-1');
      expect(res.rows[0].item).not.toBe('ALT'); // the order line's internal code
    });

    it('looks reviewed deleted-item codes up inside this lab only, for unresolved ids only', async () => {
      prisma.catalogItem.findMany.mockResolvedValue([]);
      await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(
        prisma.billingDeletedItemCode.findMany.mock.calls[0][0].where
      ).toEqual({ labTenantId: LAB, catalogItemId: { in: ['t1'] } });
    });

    it('a live catalog item without a code is not rescued by a deleted-item code', async () => {
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 't1', billingCode: null },
      ]);
      prisma.billingDeletedItemCode.findMany.mockResolvedValue([
        { catalogItemId: 't1', billingCode: 'STALE' },
      ]);
      const p = await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(p.missingCodes[0]).toMatchObject({ reason: 'NO_BILLING_CODE' });
      expect(p.lines[0].item).toBeNull();
    });

    it('fails with a clear error when there is nothing to export', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      await expect(service.generate(LAB, USER, range)).rejects.toThrow(
        BadRequestException
      );
    });

    it('takes the per-lab lock first, then computes and writes inside one transaction', async () => {
      const calls: string[] = [];
      prisma.$executeRaw.mockImplementation(async () => {
        calls.push('lock');
      });
      prisma.order.findMany.mockImplementation(async () => {
        calls.push('compute');
        return [orderRow()];
      });
      prisma.billingExport.create.mockImplementation(async () => {
        calls.push('create');
        return { id: 'exp1', createdAt: new Date() };
      });
      prisma.billingExportLine.createMany.mockImplementation(async () => {
        calls.push('lines');
        return { count: 1 };
      });
      await service.generate(LAB, USER, range);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(['lock', 'compute', 'create', 'lines']);
      expect(String(prisma.$executeRaw.mock.calls[0][0])).toContain(
        'pg_advisory_xact_lock'
      );
      expect(prisma.$executeRaw.mock.calls[0][1]).toBe(`billing-export:${LAB}`);
    });

    it('the preview is read-only: no transaction, no lock, nothing written', async () => {
      await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.billingExport.create).not.toHaveBeenCalled();
    });

    it('stores the rows as generated (code frozen) in one transaction', async () => {
      await service.generate(LAB, USER, range);
      expect(prisma.billingExport.create.mock.calls[0][0].data).toMatchObject({
        labTenantId: LAB,
        createdByUserId: 'u1',
        timezone: 'America/Bogota',
        lineCount: 1,
      });
      expect(prisma.billingExportLine.createMany.mock.calls[0][0].data).toEqual([
        expect.objectContaining({
          exportId: 'exp1',
          orderId: 'o1',
          lineKey: 'line-0',
          item: 'ALT-B',
          position: 0,
        }),
      ]);
    });
  });

  describe('repeated exports', () => {
    const range = { dateFrom: '2026-10-18', dateTo: '2026-10-18' };
    const prior = (lineKey: string, item = 'ALT-B') => ({
      orderId: 'o1',
      lineKey,
      item,
      exportId: 'old',
      export: { createdAt: new Date('2026-10-19T08:00:00Z') },
    });

    it('flags previously exported lines but keeps them in the file by default', async () => {
      prisma.billingExportLine.findMany.mockResolvedValue([prior('line-0')]);
      const p = await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(p.lines).toHaveLength(1);
      expect(p.lines[0].previouslyExported).toMatchObject({ exportId: 'old' });
      expect(p.summary).toMatchObject({
        lines: 1,
        alreadyExported: 1,
        notExportedBefore: 0,
      });
      const res = await service.generate(LAB, USER, range);
      expect(res.rows).toHaveLength(1);
    });

    it('"only new" leaves them out, and says so when nothing is left', async () => {
      prisma.billingExportLine.findMany.mockResolvedValue([prior('line-0')]);
      await expect(
        service.generate(LAB, USER, { ...range, onlyNew: true })
      ).rejects.toThrow(BadRequestException);
    });

    it('a test added after an export is new, and its order is marked as exported before', async () => {
      prisma.order.findMany.mockResolvedValue([
        orderRow({
          orderedItems: [
            orderedItem('t1', 'TEST', 'ALT'),
            orderedItem('t2', 'TEST', 'AST'),
          ],
        }),
      ]);
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 't1', billingCode: 'ALT-B' },
        { id: 't2', billingCode: 'AST-B' },
      ]);
      prisma.billingExportLine.findMany.mockResolvedValue([prior('line-0')]);
      const onlyNew = await service.generate(LAB, USER, {
        ...range,
        onlyNew: true,
      });
      expect(onlyNew.rows.map((r) => r.item)).toEqual(['AST-B']);
      const p = await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(p.lines[1]).toMatchObject({
        previouslyExported: null,
        orderPreviouslyExported: true,
      });
    });

    it('reports lines exported earlier that were cancelled since', async () => {
      prisma.order.findMany.mockResolvedValue([
        orderRow({ status: 'CANCELLED' }),
      ]);
      prisma.billingExportLine.findMany.mockResolvedValue([prior('line-0')]);
      const p = await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(p.withdrawnSinceExport).toEqual([
        expect.objectContaining({
          orderId: 'o1',
          lineKey: 'line-0',
          item: 'ALT-B',
          reason: 'ORDER_CANCELLED',
        }),
      ]);
      expect(p.lines).toHaveLength(0);
    });

    it('uses the latest earlier export when a line was exported more than once', async () => {
      prisma.billingExportLine.findMany.mockResolvedValue([
        { ...prior('line-0', 'NEW'), exportId: 'newer' },
        { ...prior('line-0', 'OLD'), exportId: 'older' },
      ]);
      const p = await service.preview(LAB, range.dateFrom, range.dateTo);
      expect(p.lines[0].previouslyExported).toMatchObject({
        exportId: 'newer',
        item: 'NEW',
      });
    });
  });

  describe('history and re-download', () => {
    it('re-download returns the stored rows, ignoring today\'s catalog mapping', async () => {
      prisma.billingExport.findFirst.mockResolvedValue({
        id: 'exp1',
        createdAt: new Date(),
        dateFrom: '2026-10-18',
        dateTo: '2026-10-18',
        timezone: 'America/Bogota',
        onlyNew: false,
        lines: [
          {
            fecha: '2026-10-18',
            entidad: 'Old Clinic Name',
            item: 'OLD-CODE',
            cantidad: 1,
            patientName: 'Max',
          },
        ],
      });
      // The catalog now says something else; it must not be consulted
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 't1', billingCode: 'NEW-CODE' },
      ]);
      const res = await service.get(LAB, 'exp1');
      expect(res.rows[0].item).toBe('OLD-CODE');
      expect(prisma.catalogItem.findMany).not.toHaveBeenCalled();
    });

    it('looks the export up inside this lab only', async () => {
      await expect(service.get(LAB, 'someone-elses')).rejects.toThrow(
        NotFoundException
      );
      expect(prisma.billingExport.findFirst.mock.calls[0][0].where).toEqual({
        id: 'someone-elses',
        labTenantId: LAB,
      });
    });

    it('lists only this lab\'s exports', async () => {
      await service.list(LAB);
      expect(prisma.billingExport.findMany.mock.calls[0][0].where).toEqual({
        labTenantId: LAB,
      });
    });
  });
});
