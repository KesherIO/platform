/**
 * Batch result entry against a real Postgres: atomicity and the report lock
 * can't be proven with mocks.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set. Point it at a throwaway
 * database with the schema applied (local Postgres, `prisma db push`, or a
 * disposable Supabase branch) — never at dev or prod:
 *
 *   cd apps/api && INTEGRATION_DATABASE_URL=postgres://… \
 *     node ../../node_modules/.bin/jest --config jest.config.js result-entry.batch.int
 *
 * Creates its own lab, clinic, orders and template, and deletes them after.
 */
import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { ResultEntryService } from './result-entry.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Batch result entry against Postgres', () => {
  let prisma: PrismaService;
  let service: ResultEntryService;
  const runId = randomUUID().slice(0, 8);

  let labId: string;
  let clinicId: string;
  let userId: string;
  let analyteA: string; // required
  let analyteB: string; // required
  const created: { orders: string[]; cases: string[]; defs: string[] } = {
    orders: [],
    cases: [],
    defs: [],
  };

  async function newOrder(testStatuses: string[]) {
    const kase = await prisma.case.create({
      data: {
        tenantId: clinicId,
        patientName: `IT ${runId}`,
        patientSpecies: 'DOG',
        ownerName: 'Owner',
        createdByUserId: userId,
      },
    });
    created.cases.push(kase.id);
    const order = await prisma.order.create({
      data: {
        requisitionNumber: `IT-${randomUUID().slice(0, 8)}`,
        caseId: kase.id,
        tenantId: clinicId,
        labTenantId: labId,
        orderedItems: [],
      },
    });
    created.orders.push(order.id);
    const tests = [];
    for (const status of testStatuses) {
      tests.push(
        await prisma.orderedTest.create({
          data: {
            orderId: order.id,
            catalogItemName: 'Chemistry',
            catalogItemCode: `CHEM-${runId}`,
            status: status as never,
          },
        })
      );
    }
    return { order, tests };
  }

  const entry = (testId: string, values: Record<string, number>) => ({
    testId,
    analytes: Object.entries(values).map(([templateAnalyteId, v]) => ({
      templateAnalyteId,
      numericValue: v,
    })),
  });

  const analyteCount = (orderId: string) =>
    prisma.resultReportAnalyte.count({
      where: { reportTest: { report: { orderId } } },
    });

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    service = new ResultEntryService(
      prisma,
      new TemplateVersionService(prisma)
    );

    const lab = await prisma.tenant.create({
      data: { name: `IT lab ${runId}`, slug: `it-lab-${runId}`, type: 'LAB' },
    });
    const clinic = await prisma.tenant.create({
      data: { name: `IT clinic ${runId}`, slug: `it-clinic-${runId}` },
    });
    labId = lab.id;
    clinicId = clinic.id;
    const user = await prisma.user.create({
      data: { id: randomUUID(), email: `it-${runId}@it.example.com` },
    });
    userId = user.id;

    const def = await prisma.resultTemplateDefinition.create({
      data: {
        catalogItemCode: `CHEM-${runId}`,
        species: 'DOG',
        scope: 'LABORATORY',
        labTenantId: labId,
        ownerKey: labId,
      },
    });
    created.defs.push(def.id);
    const version = await prisma.resultTemplateVersion.create({
      data: {
        definitionId: def.id,
        version: 1,
        title: 'Chemistry',
        status: 'PUBLISHED',
      },
    });
    await prisma.resultTemplateDefinition.update({
      where: { id: def.id },
      data: { activeVersionId: version.id },
    });
    const a = await prisma.resultTemplateAnalyte.create({
      data: {
        versionId: version.id,
        code: 'GLU',
        name: 'Glucosa',
        valueType: 'NUMERIC',
        sortOrder: 1,
      },
    });
    const b = await prisma.resultTemplateAnalyte.create({
      data: {
        versionId: version.id,
        code: 'BUN',
        name: 'Urea',
        valueType: 'NUMERIC',
        sortOrder: 2,
      },
    });
    analyteA = a.id;
    analyteB = b.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.case.deleteMany({ where: { id: { in: created.cases } } });
    await prisma.resultTemplateDefinition.updateMany({
      where: { id: { in: created.defs } },
      data: { activeVersionId: null },
    });
    await prisma.resultTemplateVersion.deleteMany({
      where: { definitionId: { in: created.defs } },
    });
    await prisma.resultTemplateDefinition.deleteMany({
      where: { id: { in: created.defs } },
    });
    await prisma.tenant.deleteMany({
      where: { id: { in: [labId, clinicId] } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('saves and submits a one-order batch', async () => {
    const { order, tests } = await newOrder(['READY', 'READY']);

    const { results } = await service.batchSaveAndSubmit(
      labId,
      tests.map((t) => entry(t.id, { [analyteA]: 90, [analyteB]: 20 })),
      true,
      userId,
      'IT'
    );

    expect(results.every((r) => r.submitted)).toBe(true);
    expect(await analyteCount(order.id)).toBe(4);
    const statuses = await prisma.orderedTest.findMany({
      where: { orderId: order.id },
      select: { status: true },
    });
    expect(statuses.map((s) => s.status)).toEqual([
      'RESULTS_ENTERED',
      'RESULTS_ENTERED',
    ]);
  });

  it('rejects a batch mixing two orders and writes nothing', async () => {
    const one = await newOrder(['READY']);
    const two = await newOrder(['READY']);

    await expect(
      service.batchSaveAndSubmit(
        labId,
        [
          entry(one.tests[0].id, { [analyteA]: 90 }),
          entry(two.tests[0].id, { [analyteA]: 95 }),
        ],
        false,
        userId,
        'IT'
      )
    ).rejects.toThrow(BadRequestException);

    expect(await analyteCount(one.order.id)).toBe(0);
    expect(await analyteCount(two.order.id)).toBe(0);
    expect(
      await prisma.resultReport.count({
        where: { orderId: { in: [one.order.id, two.order.id] } },
      })
    ).toBe(0);
  });

  it('rejects a batch containing a released test and leaves its values alone', async () => {
    const { order, tests } = await newOrder(['READY', 'READY']);
    const [released, open] = tests;
    await service.batchSaveAndSubmit(
      labId,
      [entry(released.id, { [analyteA]: 90, [analyteB]: 20 })],
      false,
      userId,
      'IT'
    );
    // What a release leaves behind for that test
    await prisma.resultReportTest.updateMany({
      where: { orderedTestId: released.id },
      data: { status: 'RELEASED' },
    });
    await prisma.orderedTest.update({
      where: { id: released.id },
      data: { status: 'COMPLETED' },
    });

    await expect(
      service.batchSaveAndSubmit(
        labId,
        [
          entry(released.id, { [analyteA]: 999, [analyteB]: 999 }),
          entry(open.id, { [analyteA]: 80 }),
        ],
        false,
        userId,
        'IT'
      )
    ).rejects.toThrow(ConflictException);

    const values = await prisma.resultReportAnalyte.findMany({
      where: { reportTest: { orderedTestId: released.id } },
      select: { numericValue: true },
    });
    expect(values.map((v) => v.numericValue).sort()).toEqual([20, 90]);
    expect(
      await prisma.resultReportAnalyte.count({
        where: { reportTest: { orderedTestId: open.id } },
      })
    ).toBe(0);
    expect(order.id).toBeDefined();
  });

  it('rolls back the saves when submit validation fails', async () => {
    const { order, tests } = await newOrder(['READY', 'READY']);

    await expect(
      service.batchSaveAndSubmit(
        labId,
        [
          entry(tests[0].id, { [analyteA]: 90, [analyteB]: 20 }),
          entry(tests[1].id, { [analyteA]: 85 }), // Urea is required
        ],
        true,
        userId,
        'IT'
      )
    ).rejects.toThrow(BadRequestException);

    expect(await analyteCount(order.id)).toBe(0);
    const statuses = await prisma.orderedTest.findMany({
      where: { orderId: order.id },
      select: { status: true },
    });
    expect(statuses.map((s) => s.status)).toEqual(['READY', 'READY']);
    expect(
      await prisma.timelineEvent.count({ where: { orderId: order.id } })
    ).toBe(0);
  });

  it('a release that commits while the batch waits for the lock wins: the batch is rejected', async () => {
    const { order, tests } = await newOrder(['READY']);
    const [test] = tests;
    await service.batchSaveAndSubmit(
      labId,
      [entry(test.id, { [analyteA]: 90, [analyteB]: 20 })],
      false,
      userId,
      'IT'
    );
    const report = await prisma.resultReport.findUniqueOrThrow({
      where: { orderId: order.id },
    });

    // A release in progress: holds the report lock until we let it commit
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    let commit!: () => void;
    const commitGate = new Promise<void>((r) => (commit = r));
    const release = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM result_reports WHERE id = ${report.id} FOR UPDATE`;
        await tx.resultReportTest.updateMany({
          where: { orderedTestId: test.id },
          data: { status: 'RELEASED' },
        });
        await tx.orderedTest.update({
          where: { id: test.id },
          data: { status: 'COMPLETED' },
        });
        locked();
        await commitGate;
      },
      { timeout: 20000 }
    );
    await isLocked;

    // Passes the first check (the release hasn't committed), then waits
    const save = service.batchSaveAndSubmit(
      labId,
      [entry(test.id, { [analyteA]: 999, [analyteB]: 999 })],
      false,
      userId,
      'IT'
    );
    const saveResult = save.then(
      () => 'saved',
      (e: unknown) => e
    );
    await new Promise((r) => setTimeout(r, 300));
    commit();
    await release;

    expect(await saveResult).toBeInstanceOf(ConflictException);
    const values = await prisma.resultReportAnalyte.findMany({
      where: { reportTest: { orderedTestId: test.id } },
      select: { numericValue: true },
    });
    expect(values.map((v) => v.numericValue).sort()).toEqual([20, 90]);
  });
});
