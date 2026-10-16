import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantRole } from '@vet-ai/shared-types';
import type { TenantContext } from '@vet-ai/shared-types';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ResultsSearchService,
  resolveDateWindow,
} from './results-search.service';

const NOW = new Date('2026-10-16T12:00:00Z');

describe('resolveDateWindow', () => {
  it('defaults to the last 30 days when nothing else narrows the search', () => {
    expect(resolveDateWindow(undefined, undefined, false, NOW)).toEqual({
      dateFrom: '2026-09-16',
      dateTo: '2026-10-16',
    });
  });

  it('keeps an explicit range of up to one year', () => {
    expect(resolveDateWindow('2025-10-16', '2026-10-16', false, NOW)).toEqual({
      dateFrom: '2025-10-16',
      dateTo: '2026-10-16',
    });
  });

  it('refuses more than a year without another filter', () => {
    expect(() =>
      resolveDateWindow('2025-01-01', '2026-10-16', false, NOW)
    ).toThrow(BadRequestException);
  });

  it('allows any range, or none, with another filter', () => {
    expect(resolveDateWindow(undefined, undefined, true, NOW)).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(resolveDateWindow('2020-01-01', undefined, true, NOW)).toEqual({
      dateFrom: '2020-01-01',
      dateTo: undefined,
    });
  });

  it('refuses a start after the end', () => {
    expect(() =>
      resolveDateWindow('2026-10-10', '2026-10-01', true, NOW)
    ).toThrow('The start date is after the end date.');
  });
});

describe('ResultsSearchService', () => {
  let prisma: Record<string, any>;
  let service: ResultsSearchService;

  const ctx = (role: TenantRole, canViewInProgress = false): TenantContext => ({
    tenantId: 'lab-1',
    tenantName: 'Lab',
    tenantLogoUrl: null,
    role,
    isOrderingVet: false,
    status: 'ACTIVE' as TenantContext['status'],
    canPerformPickups: false,
    canViewInProgress,
  });

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      orderedTest: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new ResultsSearchService(prisma as unknown as PrismaService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  it('a results viewer without the checkbox cannot list orders in progress', async () => {
    await expect(
      service.search(ctx(TenantRole.RESULTS_VIEWER), 'u', {
        view: 'in_progress',
      })
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.orderedTest.findMany).not.toHaveBeenCalled();
  });

  it.each([
    [TenantRole.RESULTS_VIEWER, true],
    [TenantRole.ANALYST, false],
  ])(
    '%s (checkbox %s) lists in-progress tests of this lab, no values',
    async (role, flag) => {
      prisma.orderedTest.findMany.mockResolvedValue([
        {
          id: 't-1',
          status: 'IN_REVIEW',
          catalogItemName: 'Chemistry',
          catalogItemCode: 'CHEM',
          order: {
            id: 'o-1',
            requisitionNumber: 'REQ-1',
            createdAt: NOW,
            tenant: { id: 'c-1', name: 'Clinic' },
            case: {
              patientName: 'Max',
              patientSpecies: 'DOG',
              ownerName: 'Ana',
            },
          },
        },
      ]);
      prisma.orderedTest.count.mockResolvedValue(1);

      const res = await service.search(ctx(role, flag), 'u', {
        view: 'in_progress',
        clinicId: 'c-1',
      });

      const where = prisma.orderedTest.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        order: { labTenantId: 'lab-1', tenantId: 'c-1' },
      });
      // Billing never sees orders the lab hasn't received; staff do
      expect(where.order.status).toEqual(
        role === TenantRole.RESULTS_VIEWER
          ? { notIn: ['PENDING', 'READY_FOR_PICKUP', 'COLLECTED'] }
          : undefined
      );
      expect(res.data).toEqual([
        {
          id: 't-1',
          status: 'IN_REVIEW',
          orderId: 'o-1',
          requisitionNumber: 'REQ-1',
          orderedAt: NOW,
          clinicId: 'c-1',
          clinicName: 'Clinic',
          patientName: 'Max',
          patientSpecies: 'DOG',
          ownerName: 'Ana',
          testName: 'Chemistry',
          testCode: 'CHEM',
        },
      ]);
      expect(res).toMatchObject({
        total: 1,
        totalPages: 1,
        view: 'in_progress',
      });
    }
  );

  it('rejects the analyte filter on orders in progress', async () => {
    await expect(
      service.search(ctx(TenantRole.ANALYST), 'u', {
        view: 'in_progress',
        analyteCode: 'GLU',
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('released search returns the paging shape and the applied dates', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: BigInt(0) }]);

    const res = await service.search(ctx(TenantRole.RESULTS_VIEWER), 'u', {});

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
      view: 'released',
    });
    expect(res.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('clinic picker lists distinct ordering clinics of this lab, sorted', async () => {
    prisma.order.findMany.mockResolvedValue([
      { tenant: { id: 'c-2', name: 'Zoo' } },
      { tenant: { id: 'c-1', name: 'Alfa' } },
    ]);

    const res = await service.getClinics('lab-1');

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { labTenantId: 'lab-1' },
      distinct: ['tenantId'],
      select: { tenant: { select: { id: true, name: true } } },
    });
    expect(res.map((c) => c.name)).toEqual(['Alfa', 'Zoo']);
  });
});
