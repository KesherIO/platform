import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, type OrderStatus } from '@prisma/client';
import { TenantRole } from '@vet-ai/shared-types';
import type { TenantContext } from '@vet-ai/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { buildDateRangeFilter } from './date-range.util';
import type { SearchResultsDto } from './dto/search-results.dto';

const DEFAULT_PAGE_SIZE = 20;
/** Without a clinic, patient or analyte filter the search is bounded in time */
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Order statuses before the sample reaches the lab */
const NOT_YET_RECEIVED: OrderStatus[] = [
  'PENDING',
  'READY_FOR_PICKUP',
  'COLLECTED',
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The date range a search runs on. With another filter (clinic, patient,
 * analyte) the given dates are used as-is, open-ended allowed. Without one,
 * the range defaults to the last 30 days and may not exceed one year, so an
 * empty search can't scan every result.
 */
export function resolveDateWindow(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  hasOtherFilter: boolean,
  now = new Date()
): { dateFrom?: string; dateTo?: string } {
  if (hasOtherFilter) {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new BadRequestException('The start date is after the end date.');
    }
    return { dateFrom, dateTo };
  }
  const to = dateTo ?? isoDay(now);
  const from =
    dateFrom ??
    isoDay(new Date(new Date(to).getTime() - DEFAULT_WINDOW_DAYS * DAY_MS));
  if (from > to) {
    throw new BadRequestException('The start date is after the end date.');
  }
  const days = (new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;
  if (days > MAX_WINDOW_DAYS) {
    throw new BadRequestException(
      'Choose a period of up to one year, or filter by clinic, patient or analyte.'
    );
  }
  return { dateFrom: from, dateTo: to };
}

/** `%term%` for ILIKE, with the user's % and _ taken literally */
const containsPattern = (term: string) =>
  `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

type ReleasedRow = {
  releaseTestId: string;
  releaseId: string;
  releaseSequence: number;
  releaseType: string;
  releasedAt: Date;
  orderId: string;
  requisitionNumber: string;
  clinicTenantId: string;
  clinicName: string;
  patientName: string;
  patientSpecies: string;
  ownerName: string;
  catalogItemName: string;
  catalogItemCode: string | null;
  amended: boolean;
  analyteName: string | null;
  analyteValueType: string | null;
  numericValue: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  selectValue: string | null;
  unit: string | null;
  flag: string | null;
};

/**
 * Resultados search (docs/RESULTS_SEARCH_PLAN.md rev. 2). Everything is
 * scoped to the caller's lab. Released rows come from the frozen release
 * snapshots, current version only; in-progress rows are statuses only.
 */
@Injectable()
export class ResultsSearchService {
  private readonly logger = new Logger(ResultsSearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  async search(tenant: TenantContext, userId: string, q: SearchResultsDto) {
    const view = q.view ?? 'released';
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
    const patient = q.patient?.trim() || undefined;

    if (view === 'in_progress') {
      if (
        tenant.role === TenantRole.RESULTS_VIEWER &&
        !tenant.canViewInProgress
      ) {
        throw new ForbiddenException(
          'You do not have access to orders in progress.'
        );
      }
      if (q.analyteCode) {
        throw new BadRequestException(
          'The analyte filter only applies to released results.'
        );
      }
    }

    const window = resolveDateWindow(
      q.dateFrom,
      q.dateTo,
      !!(q.clinicId || patient || (view === 'released' && q.analyteCode))
    );

    const result =
      view === 'released'
        ? await this.searchReleased(
            tenant.tenantId,
            q,
            patient,
            window,
            page,
            pageSize
          )
        : await this.searchInProgress(
            tenant.tenantId,
            // Billing (Consulta) only sees orders the lab has received
            tenant.role === TenantRole.RESULTS_VIEWER,
            q,
            patient,
            window,
            page,
            pageSize
          );

    // No patient names or search terms in logs, only which filters were used
    const filters = [
      q.clinicId && 'clinic',
      patient && 'patient',
      q.analyteCode && 'analyte',
      (q.dateFrom || q.dateTo) && 'dates',
    ].filter(Boolean);
    this.logger.log(
      `Results search lab=${
        tenant.tenantId
      } user=${userId} view=${view} filters=${filters.join(',') || '-'} total=${
        result.total
      }`
    );

    return {
      ...result,
      view,
      page,
      pageSize,
      totalPages: Math.ceil(result.total / pageSize),
      ...window,
    };
  }

  private async searchReleased(
    labTenantId: string,
    q: SearchResultsDto,
    patient: string | undefined,
    window: { dateFrom?: string; dateTo?: string },
    page: number,
    pageSize: number
  ) {
    const range = buildDateRangeFilter(window.dateFrom, window.dateTo);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r."labTenantId" = ${labTenantId}`,
    ];
    if (range?.gte) conditions.push(Prisma.sql`r."releasedAt" >= ${range.gte}`);
    if (range?.lte) conditions.push(Prisma.sql`r."releasedAt" <= ${range.lte}`);
    if (q.clinicId)
      conditions.push(Prisma.sql`r."clinicTenantId" = ${q.clinicId}`);
    if (patient) {
      const p = containsPattern(patient);
      conditions.push(
        Prisma.sql`(r."patientName" ILIKE ${p} ESCAPE '\\' OR r."ownerName" ILIKE ${p} ESCAPE '\\' OR r."requisitionNumber" ILIKE ${p} ESCAPE '\\')`
      );
    }
    if (q.analyteCode) conditions.push(Prisma.sql`a.id IS NOT NULL`);
    const where = Prisma.join(conditions, ' AND ');

    // Current version only: the source test's latest release is this release
    const from = Prisma.sql`
      FROM result_report_release_tests rt
      JOIN result_report_releases r ON r.id = rt."releaseId"
      JOIN result_report_tests st
        ON st.id = rt."sourceReportTestId" AND st."latestReleaseId" = r.id
      ${
        q.analyteCode
          ? Prisma.sql`LEFT JOIN LATERAL (
              SELECT a2.* FROM result_report_release_analytes a2
              WHERE a2."releaseTestId" = rt.id AND a2.code = ${q.analyteCode}
              ORDER BY a2."sortOrder" LIMIT 1
            ) a ON true`
          : Prisma.empty
      }
      WHERE ${where}`;
    const analyteColumns = q.analyteCode
      ? Prisma.sql`a.name AS "analyteName", a."valueType"::text AS "analyteValueType",
          a."numericValue", a."textValue", a."booleanValue", a."selectValue",
          a.unit, a.flag`
      : Prisma.sql`NULL AS "analyteName"`;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<ReleasedRow[]>`
        SELECT rt.id AS "releaseTestId", r.id AS "releaseId",
          r."releaseSequence", r."releaseType", r."releasedAt",
          r."orderId", r."requisitionNumber", r."clinicTenantId", r."clinicName",
          r."patientName", r."patientSpecies", r."ownerName",
          rt."catalogItemName", rt."catalogItemCode",
          (rt."amendsReleaseTestId" IS NOT NULL) AS "amended",
          ${analyteColumns}
        ${from}
        ORDER BY r."releasedAt" DESC, rt.id
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT COUNT(*) AS count ${from}`,
    ]);

    return {
      total: Number(counted[0]?.count ?? 0),
      data: rows.map((r) => ({
        id: r.releaseTestId,
        releaseId: r.releaseId,
        releaseSequence: r.releaseSequence,
        releaseType: r.releaseType,
        releasedAt: r.releasedAt,
        amended: r.amended,
        orderId: r.orderId,
        requisitionNumber: r.requisitionNumber,
        clinicId: r.clinicTenantId,
        clinicName: r.clinicName,
        patientName: r.patientName,
        patientSpecies: r.patientSpecies,
        ownerName: r.ownerName,
        testName: r.catalogItemName,
        testCode: r.catalogItemCode,
        analyte: q.analyteCode
          ? {
              code: q.analyteCode,
              name: r.analyteName,
              valueType: r.analyteValueType,
              numericValue: r.numericValue,
              textValue: r.textValue,
              booleanValue: r.booleanValue,
              selectValue: r.selectValue,
              unit: r.unit,
              flag: r.flag,
            }
          : null,
      })),
    };
  }

  private async searchInProgress(
    labTenantId: string,
    receivedOnly: boolean,
    q: SearchResultsDto,
    patient: string | undefined,
    window: { dateFrom?: string; dateTo?: string },
    page: number,
    pageSize: number
  ) {
    const where: Prisma.OrderedTestWhereInput = {
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      order: {
        labTenantId,
        ...(receivedOnly && { status: { notIn: NOT_YET_RECEIVED } }),
        ...(q.clinicId && { tenantId: q.clinicId }),
        ...(window.dateFrom || window.dateTo
          ? { createdAt: buildDateRangeFilter(window.dateFrom, window.dateTo) }
          : {}),
        ...(patient && {
          OR: [
            { requisitionNumber: { contains: patient, mode: 'insensitive' } },
            {
              case: { patientName: { contains: patient, mode: 'insensitive' } },
            },
            { case: { ownerName: { contains: patient, mode: 'insensitive' } } },
          ],
        }),
      },
    };

    // Statuses only — no result values ever leave this query
    const [tests, total] = await Promise.all([
      this.prisma.orderedTest.findMany({
        where,
        select: {
          id: true,
          status: true,
          catalogItemName: true,
          catalogItemCode: true,
          order: {
            select: {
              id: true,
              requisitionNumber: true,
              createdAt: true,
              tenant: { select: { id: true, name: true } },
              case: {
                select: {
                  patientName: true,
                  patientSpecies: true,
                  ownerName: true,
                },
              },
            },
          },
        },
        orderBy: [{ order: { createdAt: 'desc' } }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.orderedTest.count({ where }),
    ]);

    return {
      total,
      data: tests.map((t) => ({
        id: t.id,
        status: t.status,
        orderId: t.order.id,
        requisitionNumber: t.order.requisitionNumber,
        orderedAt: t.order.createdAt,
        clinicId: t.order.tenant.id,
        clinicName: t.order.tenant.name,
        patientName: t.order.case.patientName,
        patientSpecies: t.order.case.patientSpecies,
        ownerName: t.order.case.ownerName,
        testName: t.catalogItemName,
        testCode: t.catalogItemCode,
      })),
    };
  }

  /** Clinics that sent this lab orders — the "entidad" picker */
  async getClinics(labTenantId: string) {
    const orders = await this.prisma.order.findMany({
      where: { labTenantId },
      distinct: ['tenantId'],
      select: { tenant: { select: { id: true, name: true } } },
    });
    return orders
      .map((o) => o.tenant)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Analytes seen in this lab's releases (code + latest name), for the picker */
  async getAnalytes(labTenantId: string, search?: string) {
    const term = search?.trim();
    const filter = term
      ? Prisma.sql`AND (a.code ILIKE ${containsPattern(
          term
        )} ESCAPE '\\' OR a.name ILIKE ${containsPattern(term)} ESCAPE '\\')`
      : Prisma.empty;
    return this.prisma.$queryRaw<{ code: string; name: string }[]>`
      SELECT code, name FROM (
        SELECT DISTINCT ON (a.code) a.code, a.name
        FROM result_report_release_analytes a
        JOIN result_report_release_tests rt ON rt.id = a."releaseTestId"
        JOIN result_report_releases r ON r.id = rt."releaseId"
        WHERE r."labTenantId" = ${labTenantId} AND a."isHeader" = false ${filter}
        ORDER BY a.code, r."releasedAt" DESC
      ) latest
      ORDER BY name
      LIMIT 30`;
  }
}
