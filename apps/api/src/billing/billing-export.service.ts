import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { OrderedItem } from '@vet-ai/shared-types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  deriveBillableLines,
  type BillableLine,
  type ExclusionReason,
} from './billable-lines.util';
import {
  MAX_RANGE_DAYS,
  daysBetween,
  formatDayInTimezone,
  inclusiveDayRange,
  isValidDay,
  isValidTimezone,
} from './billing-date.util';

/** Past this many orders or lines the export fails rather than being cut off. */
export const BILLING_EXPORT_MAX_ORDERS = 10_000;
export const BILLING_EXPORT_MAX_LINES = 20_000;
/** Lines sent back by the preview; the summary always counts all of them. */
export const BILLING_PREVIEW_LINES = 500;
const HISTORY_PAGE = 50;

/** Reads and writes inside generate() share one transaction client. */
type Db = Pick<
  Prisma.TransactionClient,
  | 'tenant'
  | 'order'
  | 'catalogItem'
  | 'billingDeletedItemCode'
  | 'billingExportLine'
>;

/**
 * The file's columns, in order. `key` is the property in the rows the API
 * returns; `header` is the exact title written to the file.
 */
export const BILLING_COLUMNS = [
  { key: 'fecha', header: 'fecha' },
  { key: 'entidad', header: 'entidad' },
  { key: 'item', header: 'item' },
  { key: 'cantidad', header: 'cantidad' },
  { key: 'patientName', header: 'nombre del paciente' },
] as const;

export interface BillingRow {
  fecha: string;
  entidad: string;
  item: string;
  cantidad: number;
  patientName: string;
}

type PreviousExport = { exportId: string; exportedAt: Date; item: string };

interface Computed {
  timezone: string;
  range: { dateFrom: string; dateTo: string };
  orderCount: number;
  lines: Array<
    BillableLine & {
      fecha: string;
      billingCode: string | null;
      /** Where the code came from: the catalog item, or a reviewed code for a deleted one */
      codeSource: 'CATALOG' | 'DELETED_ITEM' | null;
      missing: 'NO_BILLING_CODE' | 'ITEM_NOT_IN_CATALOG' | null;
      previouslyExported: PreviousExport | null;
      /** A sibling line of this order is in an earlier export */
      orderPreviouslyExported: boolean;
    }
  >;
  excludedCounts: Record<ExclusionReason, number>;
  withdrawn: Array<{
    orderId: string;
    requisitionNumber: string;
    lineKey: string;
    item: string;
    exportId: string;
    exportedAt: Date;
    reason: ExclusionReason | 'NOT_BILLABLE';
  }>;
}

@Injectable()
export class BillingExportService {
  private readonly logger = new Logger(BillingExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Shared computation — what the preview shows is what generate writes
  // -------------------------------------------------------------------------

  private async compute(
    db: Db,
    labTenantId: string,
    dateFrom: string,
    dateTo: string
  ): Promise<Computed> {
    if (!isValidDay(dateFrom) || !isValidDay(dateTo)) {
      throw new BadRequestException('Dates must be real days as YYYY-MM-DD.');
    }
    if (dateFrom > dateTo) {
      throw new BadRequestException('The start date is after the end date.');
    }
    if (daysBetween(dateFrom, dateTo) + 1 > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `The range can cover at most ${MAX_RANGE_DAYS} days.`
      );
    }

    const lab = await db.tenant.findUnique({
      where: { id: labTenantId },
      select: { timezone: true },
    });
    const timezone =
      lab?.timezone && isValidTimezone(lab.timezone) ? lab.timezone : 'UTC';
    const { gte, lt } = inclusiveDayRange(dateFrom, dateTo, timezone);

    // Every order the lab received in the range, whatever its status: pending
    // and completed alike; cancelled ones are dropped by deriveBillableLines
    // (and kept as exclusions to explain what changed since an earlier export).
    const orders = await db.order.findMany({
      where: { labTenantId, createdAt: { gte, lt } },
      orderBy: [{ createdAt: 'asc' }, { requisitionNumber: 'asc' }],
      take: BILLING_EXPORT_MAX_ORDERS + 1,
      select: {
        id: true,
        requisitionNumber: true,
        status: true,
        createdAt: true,
        orderedItems: true,
        tenant: { select: { name: true } },
        case: { select: { patientName: true } },
        orderedTests: {
          select: {
            catalogItemId: true,
            status: true,
            sources: { select: { originalOrderItemKey: true } },
          },
        },
      },
    });
    if (orders.length > BILLING_EXPORT_MAX_ORDERS) {
      throw new BadRequestException({
        code: 'EXPORT_TOO_LARGE',
        message: `More than ${BILLING_EXPORT_MAX_ORDERS} orders in this range. Choose a shorter range.`,
      });
    }

    const { lines, excluded } = deriveBillableLines(
      orders.map((o) => ({
        id: o.id,
        requisitionNumber: o.requisitionNumber,
        status: o.status,
        createdAt: o.createdAt,
        clinicName: o.tenant.name,
        patientName: o.case.patientName,
        orderedItems: o.orderedItems as unknown as OrderedItem[],
        orderedTests: o.orderedTests,
      }))
    );
    if (lines.length > BILLING_EXPORT_MAX_LINES) {
      throw new BadRequestException({
        code: 'EXPORT_TOO_LARGE',
        message: `More than ${BILLING_EXPORT_MAX_LINES} billable lines in this range. Choose a shorter range.`,
      });
    }

    // Current mapping, this lab's catalog only: an id from elsewhere resolves
    // to nothing and shows up as missing.
    const catalogIds = [...new Set(lines.map((l) => l.catalogItemId))];
    const catalog = catalogIds.length
      ? await db.catalogItem.findMany({
          where: { labTenantId, id: { in: catalogIds } },
          select: { id: true, billingCode: true },
        })
      : [];
    const codeById = new Map(catalog.map((c) => [c.id, c.billingCode]));

    // Lines whose catalog item no longer exists: only a code the lab reviewed
    // and assigned to that deleted item (BillingDeletedItemCode) resolves them
    const deletedIds = catalogIds.filter((id) => !codeById.has(id));
    const deletedCodes = deletedIds.length
      ? await db.billingDeletedItemCode.findMany({
          where: { labTenantId, catalogItemId: { in: deletedIds } },
          select: { catalogItemId: true, billingCode: true },
        })
      : [];
    const deletedCodeById = new Map(
      deletedCodes.map((d) => [d.catalogItemId, d.billingCode])
    );

    // Latest earlier export of each order line (this lab's only)
    const orderIds = orders.map((o) => o.id);
    const previous = orderIds.length
      ? await db.billingExportLine.findMany({
          where: { orderId: { in: orderIds }, export: { labTenantId } },
          orderBy: { export: { createdAt: 'desc' } },
          select: {
            orderId: true,
            lineKey: true,
            item: true,
            exportId: true,
            export: { select: { createdAt: true } },
          },
        })
      : [];
    const latest = new Map<string, PreviousExport>();
    const ordersWithPrior = new Set<string>();
    for (const p of previous) {
      ordersWithPrior.add(p.orderId);
      const key = `${p.orderId}:${p.lineKey}`;
      if (!latest.has(key)) {
        latest.set(key, {
          exportId: p.exportId,
          exportedAt: p.export.createdAt,
          item: p.item,
        });
      }
    }

    const computedLines = lines.map((l) => {
      const inCatalog = codeById.has(l.catalogItemId);
      const billingCode = inCatalog
        ? codeById.get(l.catalogItemId) ?? null
        : deletedCodeById.get(l.catalogItemId) ?? null;
      return {
        ...l,
        fecha: formatDayInTimezone(l.orderCreatedAt, timezone),
        billingCode,
        codeSource: !billingCode
          ? null
          : inCatalog
          ? ('CATALOG' as const)
          : ('DELETED_ITEM' as const),
        missing: billingCode
          ? null
          : inCatalog
          ? ('NO_BILLING_CODE' as const)
          : ('ITEM_NOT_IN_CATALOG' as const),
        previouslyExported: latest.get(`${l.orderId}:${l.lineKey}`) ?? null,
        orderPreviouslyExported: ordersWithPrior.has(l.orderId),
      };
    });

    // Exported before, but no longer a charge (cancelled since)
    const currentKeys = new Set(lines.map((l) => `${l.orderId}:${l.lineKey}`));
    const reasonByKey = new Map(
      excluded.map((e) => [`${e.orderId}:${e.lineKey}`, e.reason])
    );
    const reqById = new Map(orders.map((o) => [o.id, o.requisitionNumber]));
    const withdrawn = [...latest.entries()]
      .filter(([key]) => !currentKeys.has(key))
      .map(([key, prev]) => {
        const [orderId, lineKey] = [
          key.slice(0, key.indexOf(':')),
          key.slice(key.indexOf(':') + 1),
        ];
        return {
          orderId,
          requisitionNumber: reqById.get(orderId) ?? '',
          lineKey,
          item: prev.item,
          exportId: prev.exportId,
          exportedAt: prev.exportedAt,
          reason: reasonByKey.get(key) ?? ('NOT_BILLABLE' as const),
        };
      });

    const excludedCounts: Record<ExclusionReason, number> = {
      ORDER_CANCELLED: 0,
      ITEM_CANCELLED: 0,
    };
    for (const e of excluded) excludedCounts[e.reason]++;

    return {
      timezone,
      range: { dateFrom, dateTo },
      orderCount: orders.length,
      lines: computedLines,
      excludedCounts,
      withdrawn,
    };
  }

  private missingCodes(lines: Computed['lines']) {
    const groups = new Map<
      string,
      {
        catalogItemId: string;
        name: string;
        internalCode: string | null;
        kind: 'TEST' | 'PACKAGE';
        reason: 'NO_BILLING_CODE' | 'ITEM_NOT_IN_CATALOG';
        lineCount: number;
        orderIds: Set<string>;
      }
    >();
    for (const l of lines) {
      if (!l.missing) continue;
      const g = groups.get(l.catalogItemId) ?? {
        catalogItemId: l.catalogItemId,
        name: l.name,
        internalCode: l.internalCode,
        kind: l.kind,
        reason: l.missing,
        lineCount: 0,
        orderIds: new Set<string>(),
      };
      g.lineCount++;
      g.orderIds.add(l.orderId);
      groups.set(l.catalogItemId, g);
    }
    return [...groups.values()].map(({ orderIds, ...g }) => ({
      ...g,
      orderCount: orderIds.size,
    }));
  }

  // -------------------------------------------------------------------------
  // Preview — read-only
  // -------------------------------------------------------------------------

  async preview(
    labTenantId: string,
    dateFrom: string,
    dateTo: string,
    onlyNew = false
  ) {
    const c = await this.compute(this.prisma, labTenantId, dateFrom, dateTo);
    const missingCodes = this.missingCodes(c.lines);
    const lines = onlyNew
      ? c.lines.filter((l) => !l.previouslyExported)
      : c.lines;
    const alreadyExported = c.lines.filter((l) => l.previouslyExported).length;
    const missingLines = lines.filter((l) => l.missing).length;

    return {
      range: c.range,
      timezone: c.timezone,
      onlyNew,
      summary: {
        orders: c.orderCount,
        lines: lines.length,
        alreadyExported,
        notExportedBefore: c.lines.length - alreadyExported,
        missingCode: missingLines,
        cancelledOrderLines: c.excludedCounts.ORDER_CANCELLED,
        cancelledItemLines: c.excludedCounts.ITEM_CANCELLED,
      },
      // Every line is listed: previously exported ones are flagged, not hidden
      // (unless the user asked for "only new")
      lines: lines.slice(0, BILLING_PREVIEW_LINES).map((l) => ({
        orderId: l.orderId,
        requisitionNumber: l.requisitionNumber,
        lineKey: l.lineKey,
        fecha: l.fecha,
        entidad: l.clinicName,
        item: l.billingCode,
        cantidad: l.quantity,
        patientName: l.patientName,
        serviceName: l.name,
        kind: l.kind,
        catalogItemId: l.catalogItemId,
        missing: l.missing,
        codeSource: l.codeSource,
        previouslyExported: l.previouslyExported,
        orderPreviouslyExported: l.orderPreviouslyExported,
      })),
      linesTruncated: lines.length > BILLING_PREVIEW_LINES,
      missingCodes,
      withdrawnSinceExport: c.withdrawn,
      canGenerate: missingLines === 0 && lines.length > 0,
    };
  }

  // -------------------------------------------------------------------------
  // Generate — records the file's rows; the client writes xlsx/csv from them
  // -------------------------------------------------------------------------

  /**
   * One transaction does everything: it takes a per-lab lock, recomputes the
   * lines, and writes the export and all its lines. Either the whole file is
   * recorded or nothing is (a failure at any step rolls back, so there is no
   * partial history).
   *
   * The lock makes concurrent generations for the same lab run one after the
   * other: the second waits, then reads the first one's committed lines. So
   * with "only new" the two files never overlap (the second gets only what
   * the first did not include, or "nothing to export"), while without it both
   * contain every line — as asked — and the second marks them as exported
   * before. Different labs never wait for each other.
   */
  async generate(
    labTenantId: string,
    user: { id: string; name: string },
    input: { dateFrom: string; dateTo: string; onlyNew?: boolean }
  ) {
    const onlyNew = input.onlyNew === true;

    const { record, rows, c } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-export:${labTenantId}`}, 0))`;

        const c = await this.compute(
          tx,
          labTenantId,
          input.dateFrom,
          input.dateTo
        );

        const missingCodes = this.missingCodes(c.lines);
        if (missingCodes.length > 0) {
          // Never leave an item out or fall back to the internal code
          throw new ConflictException({
            code: 'MISSING_BILLING_CODES',
            message:
              'Some ordered services have no billing code. Assign them before exporting.',
            missingCodes,
          });
        }

        const lines = onlyNew
          ? c.lines.filter((l) => !l.previouslyExported)
          : c.lines;
        if (lines.length === 0) {
          throw new BadRequestException({
            code: 'NOTHING_TO_EXPORT',
            message: onlyNew
              ? 'Every billable line in this range was already in an earlier export.'
              : 'There are no billable lines in this range.',
          });
        }

        const rows: BillingRow[] = lines.map((l) => ({
          fecha: l.fecha,
          entidad: l.clinicName,
          item: l.billingCode as string,
          cantidad: l.quantity,
          patientName: l.patientName,
        }));

        const record = await tx.billingExport.create({
          data: {
            labTenantId,
            createdByUserId: user.id,
            createdByName: user.name,
            dateFrom: c.range.dateFrom,
            dateTo: c.range.dateTo,
            timezone: c.timezone,
            onlyNew,
            lineCount: lines.length,
          },
          select: { id: true, createdAt: true },
        });
        await tx.billingExportLine.createMany({
          data: lines.map((l, position) => ({
            exportId: record.id,
            orderId: l.orderId,
            lineKey: l.lineKey,
            catalogItemId: l.catalogItemId,
            fecha: rows[position].fecha,
            entidad: rows[position].entidad,
            item: rows[position].item,
            cantidad: rows[position].cantidad,
            patientName: rows[position].patientName,
            position,
          })),
        });
        return { record, rows, c };
      },
      {
        // Waiting for another generation of the same lab counts against this
        maxWait: 30_000,
        timeout: 120_000,
      }
    );

    // Who, when, how many — never row contents (patient names)
    this.logger.log(
      `Billing export lab=${labTenantId} user=${user.id} export=${record.id} ` +
        `range=${c.range.dateFrom}..${c.range.dateTo} tz=${c.timezone} ` +
        `rows=${rows.length} onlyNew=${onlyNew}`
    );

    return {
      exportId: record.id,
      createdAt: record.createdAt,
      ...c.range,
      timezone: c.timezone,
      onlyNew,
      columns: BILLING_COLUMNS,
      rows,
    };
  }

  // -------------------------------------------------------------------------
  // History and re-download
  // -------------------------------------------------------------------------

  async list(labTenantId: string) {
    const exports = await this.prisma.billingExport.findMany({
      where: { labTenantId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_PAGE,
      select: {
        id: true,
        createdAt: true,
        createdByName: true,
        dateFrom: true,
        dateTo: true,
        timezone: true,
        onlyNew: true,
        lineCount: true,
      },
    });
    return { data: exports };
  }

  /** The rows exactly as generated, whatever the catalog says today. */
  async get(labTenantId: string, id: string) {
    const record = await this.prisma.billingExport.findFirst({
      where: { id, labTenantId },
      select: {
        id: true,
        createdAt: true,
        dateFrom: true,
        dateTo: true,
        timezone: true,
        onlyNew: true,
        lines: {
          orderBy: { position: 'asc' },
          select: {
            fecha: true,
            entidad: true,
            item: true,
            cantidad: true,
            patientName: true,
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Billing export not found.');

    const { lines, ...meta } = record;
    this.logger.log(
      `Billing export re-download lab=${labTenantId} export=${id} rows=${lines.length}`
    );
    return {
      exportId: meta.id,
      createdAt: meta.createdAt,
      dateFrom: meta.dateFrom,
      dateTo: meta.dateTo,
      timezone: meta.timezone,
      onlyNew: meta.onlyNew,
      columns: BILLING_COLUMNS,
      rows: lines as BillingRow[],
    };
  }
}
