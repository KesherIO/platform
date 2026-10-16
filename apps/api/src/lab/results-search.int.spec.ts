/**
 * Resultados search against a real Postgres: the released view is raw SQL
 * (current version, analyte join), so isolation and "current version only"
 * are checked on real rows.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set (throwaway database only,
 * see result-entry.batch.int.spec.ts). Rows are scoped to labs created here.
 */
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { TenantRole } from '@vet-ai/shared-types';
import type { TenantContext } from '@vet-ai/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ResultsSearchService } from './results-search.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Resultados search against Postgres', () => {
  let prisma: PrismaService;
  let service: ResultsSearchService;
  const runId = randomUUID().slice(0, 8);
  let labA: string;
  let labB: string;
  let clinic1: { id: string; name: string };
  let clinic2: { id: string; name: string };
  let userId: string;
  let defId: string;
  let versionId: string;
  const signerOf: Record<string, string> = {};

  const ctx = (
    labId: string,
    role = TenantRole.ANALYST,
    canViewInProgress = false
  ): TenantContext => ({
    tenantId: labId,
    tenantName: 'Lab',
    tenantLogoUrl: null,
    role,
    isOrderingVet: false,
    status: 'ACTIVE' as TenantContext['status'],
    canPerformPickups: false,
    canViewInProgress,
  });

  async function newOrder(
    labId: string,
    clinic: { id: string },
    patientName: string,
    testStatus = 'COMPLETED',
    orderStatus = 'COMPLETED'
  ) {
    const kase = await prisma.case.create({
      data: {
        tenantId: clinic.id,
        patientName,
        patientSpecies: 'DOG',
        ownerName: `Owner ${patientName}`,
        createdByUserId: userId,
      },
    });
    const order = await prisma.order.create({
      data: {
        requisitionNumber: `IT-${randomUUID().slice(0, 8)}`,
        caseId: kase.id,
        tenantId: clinic.id,
        labTenantId: labId,
        orderedItems: [],
        status: orderStatus as never,
      },
    });
    const test = await prisma.orderedTest.create({
      data: {
        orderId: order.id,
        catalogItemName: 'Chemistry',
        catalogItemCode: `CHEM-${runId}`,
        status: testStatus as never,
      },
    });
    return { kase, order, test };
  }

  /** A released test with one analyte; returns ids to amend it later. */
  async function released(
    labId: string,
    clinic: { id: string; name: string },
    patientName: string,
    glucose: number,
    releasedAt: Date
  ) {
    const { kase, order, test } = await newOrder(labId, clinic, patientName);
    const report = await prisma.resultReport.create({
      data: { orderId: order.id, caseId: kase.id, tenantId: clinic.id },
    });
    const reportTest = await prisma.resultReportTest.create({
      data: {
        reportId: report.id,
        orderedTestId: test.id,
        templateVersionId: versionId,
        templateDefinitionId: defId,
        status: 'RELEASED',
      },
    });
    const ids = {
      reportId: report.id,
      reportTestId: reportTest.id,
      order,
      kase,
    };
    const releaseTestId = await release(
      labId,
      clinic,
      ids,
      1,
      glucose,
      releasedAt,
      null
    );
    return { ...ids, releaseTestId };
  }

  async function release(
    labId: string,
    clinic: { id: string; name: string },
    ids: {
      reportId: string;
      reportTestId: string;
      order: { id: string; requisitionNumber: string; createdAt: Date };
      kase: { patientName: string; ownerName: string };
    },
    sequence: number,
    glucose: number,
    releasedAt: Date,
    amendsReleaseTestId: string | null
  ) {
    const rel = await prisma.resultReportRelease.create({
      data: {
        reportId: ids.reportId,
        releaseSequence: sequence,
        releaseType: amendsReleaseTestId ? 'AMENDMENT' : 'FINAL',
        signerId: signerOf[labId],
        signerName: 'Dra. IT',
        releasedByUserId: userId,
        releasedByName: 'IT',
        labTenantId: labId,
        labName: 'IT lab',
        orderId: ids.order.id,
        requisitionNumber: ids.order.requisitionNumber,
        orderPriority: 'ROUTINE',
        orderCreatedAt: ids.order.createdAt,
        patientName: ids.kase.patientName,
        patientSpecies: 'DOG',
        ownerName: ids.kase.ownerName,
        clinicTenantId: clinic.id,
        clinicName: clinic.name,
        releasedAt,
      },
    });
    const rt = await prisma.resultReportReleaseTest.create({
      data: {
        releaseId: rel.id,
        sourceReportTestId: ids.reportTestId,
        amendsReleaseTestId,
        catalogItemName: 'Chemistry',
        catalogItemCode: `CHEM-${runId}`,
        entryMethod: 'MANUAL',
        templateDefinitionId: defId,
        templateVersionId: versionId,
        templateTitle: 'Chemistry',
        templateVersion: 1,
        testCompletedAt: releasedAt,
      },
    });
    await prisma.resultReportReleaseAnalyte.createMany({
      data: [
        {
          releaseTestId: rt.id,
          code: `GLU-${runId}`,
          name: 'Glucose',
          sortOrder: 1,
          valueType: 'NUMERIC',
          numericValue: glucose,
          unit: 'mg/dL',
          flag: glucose > 120 ? 'H' : null,
        },
        {
          releaseTestId: rt.id,
          code: `BUN-${runId}`,
          name: 'Urea',
          sortOrder: 2,
          valueType: 'NUMERIC',
          numericValue: 20,
        },
      ],
    });
    await prisma.resultReportTest.update({
      where: { id: ids.reportTestId },
      data: { latestReleaseId: rel.id, latestReleasedAt: releasedAt },
    });
    return rt.id;
  }

  const recent = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    service = new ResultsSearchService(prisma);

    const mk = (name: string, type: 'LAB' | 'CLINIC') =>
      prisma.tenant.create({
        data: { name: `${name} ${runId}`, slug: `it-${name}-${runId}`, type },
      });
    labA = (await mk('labA', 'LAB')).id;
    labB = (await mk('labB', 'LAB')).id;
    for (const labId of [labA, labB]) {
      const profile = await prisma.laboratoryProfile.create({
        data: { tenantId: labId, updatedAt: new Date() },
      });
      signerOf[labId] = (
        await prisma.labSigner.create({
          data: {
            laboratoryProfileId: profile.id,
            name: 'Dra. IT',
            roles: ['REVIEWER'],
            updatedAt: new Date(),
          },
        })
      ).id;
    }
    clinic1 = await mk('clinic1', 'CLINIC');
    clinic2 = await mk('clinic2', 'CLINIC');
    userId = (
      await prisma.user.create({
        data: { id: randomUUID(), email: `it-${runId}@it.example.com` },
      })
    ).id;
    const def = await prisma.resultTemplateDefinition.create({
      data: {
        catalogItemCode: `CHEM-${runId}`,
        species: 'DOG',
        scope: 'LABORATORY',
        labTenantId: labA,
        ownerKey: labA,
      },
    });
    defId = def.id;
    versionId = (
      await prisma.resultTemplateVersion.create({
        data: {
          definitionId: def.id,
          version: 1,
          title: 'Chemistry',
          status: 'PUBLISHED',
        },
      })
    ).id;

    // Lab A: Max (amended), Luna; lab B: Rocky. Open in lab A: Kira (in the
    // lab), Nala (sample not received yet)
    const max = await released(labA, clinic1, 'Max', 100, recent(5));
    await release(labA, clinic1, max, 2, 150, recent(2), max.releaseTestId);
    await released(labA, clinic2, 'Luna', 90, recent(3));
    await released(labB, clinic1, 'Rocky', 80, recent(1));
    await newOrder(labA, clinic2, 'Kira', 'IN_PROGRESS', 'PROCESSING');
    await newOrder(labA, clinic2, 'Nala', 'PENDING', 'PENDING');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists this lab's current versions only: the amendment replaces the original", async () => {
    const res = await service.search(ctx(labA), userId, {});

    expect(res.data.map((r) => [r.patientName, r.amended])).toEqual([
      ['Max', true],
      ['Luna', false],
    ]);
    expect(res.total).toBe(2);
    expect(res.dateFrom).toBeDefined();
  });

  it('filters by clinic and by patient, owner or requisition', async () => {
    const byClinic = await service.search(ctx(labA), userId, {
      clinicId: clinic2.id,
    });
    expect(byClinic.data.map((r) => r.patientName)).toEqual(['Luna']);

    const byOwner = await service.search(ctx(labA), userId, {
      patient: 'owner max',
    });
    expect(byOwner.data.map((r) => r.patientName)).toEqual(['Max']);

    const literal = await service.search(ctx(labA), userId, { patient: '%' });
    expect(literal.total).toBe(0);
  });

  it("shows the analyte's current value and flag", async () => {
    const res = await service.search(ctx(labA), userId, {
      analyteCode: `GLU-${runId}`,
    });

    expect(
      res.data.map((r) => [
        r.patientName,
        r.analyte?.numericValue,
        r.analyte?.flag,
        r.analyte?.unit,
      ])
    ).toEqual([
      ['Max', 150, 'H', 'mg/dL'],
      ['Luna', 90, null, 'mg/dL'],
    ]);

    const none = await service.search(ctx(labA), userId, {
      analyteCode: 'NOT-THERE',
    });
    expect(none.total).toBe(0);
  });

  it('finds a corrected result by its correction date', async () => {
    const res = await service.search(ctx(labA), userId, {
      dateFrom: recent(4).toISOString().slice(0, 10),
    });
    // Max's original (5 days ago) is outside, its correction (2 days) inside
    expect(res.data.map((r) => r.patientName)).toEqual(['Max', 'Luna']);
  });

  it('pages', async () => {
    const res = await service.search(ctx(labA), userId, {
      pageSize: 1,
      page: 2,
    });
    expect(res.data.map((r) => r.patientName)).toEqual(['Luna']);
    expect(res.totalPages).toBe(2);
  });

  it('in progress: statuses only, for staff and viewers with the checkbox', async () => {
    const staff = await service.search(ctx(labA), userId, {
      view: 'in_progress',
    });
    expect(staff.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ patientName: 'Kira', status: 'IN_PROGRESS' }),
        expect.objectContaining({ patientName: 'Nala', status: 'PENDING' }),
      ])
    );
    expect(staff.total).toBe(2);
    expect(staff.data[0]).not.toHaveProperty('analyte');

    await expect(
      service.search(ctx(labA, TenantRole.RESULTS_VIEWER), userId, {
        view: 'in_progress',
      })
    ).rejects.toThrow('orders in progress');

    const billing = await service.search(
      ctx(labA, TenantRole.RESULTS_VIEWER, true),
      userId,
      { view: 'in_progress' }
    );
    // Billing doesn't see Nala: her sample hasn't reached the lab
    expect(billing.data.map((r) => r.patientName)).toEqual(['Kira']);
  });

  it('pickers only show this lab', async () => {
    expect((await service.getClinics(labB)).map((c) => c.id)).toEqual([
      clinic1.id,
    ]);
    expect(
      (await service.getAnalytes(labA, 'gluc')).map((a) => a.code)
    ).toEqual([`GLU-${runId}`]);
    expect(await service.getAnalytes(labB, 'nothing-like-this')).toEqual([]);
  });
});
