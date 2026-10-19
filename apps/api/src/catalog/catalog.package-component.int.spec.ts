/**
 * "Package component only" tests against a real Postgres: hidden from clinics
 * (catalog list, which the AI triage reads, and selecting by id), but still
 * listed for the lab and still delivered inside their package.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set (throwaway database only,
 * see lab/result-entry.batch.int.spec.ts).
 */
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CasesService } from '../cases/cases.service';
import type { TriageService } from '../triage/triage.service';
import { CatalogService } from './catalog.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Package component only (Postgres)', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  let cases: CasesService;
  const runId = randomUUID().slice(0, 8);
  let labId: string;
  let otherLabId: string;
  let clinicId: string;
  let userId: string;
  let visible: string;
  let packageId: string;
  const copro: string[] = [];

  const newCase = async () =>
    (
      await prisma.case.create({
        data: {
          tenantId: clinicId,
          patientName: `Copro ${runId}`,
          patientSpecies: 'DOG',
          ownerName: 'Owner',
          createdByUserId: userId,
        },
      })
    ).id;

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    catalog = new CatalogService(prisma);
    cases = new CasesService(prisma, {} as unknown as TriageService);

    const mk = (name: string, type: 'LAB' | 'CLINIC') =>
      prisma.tenant
        .create({
          data: { name: `${name} ${runId}`, slug: `it-pco-${name}-${runId}`, type },
        })
        .then((t) => t.id);
    labId = await mk('lab', 'LAB');
    otherLabId = await mk('lab2', 'LAB');
    clinicId = await mk('clinic', 'CLINIC');
    await prisma.clinicLabConnection.create({
      data: { clinicId, labId, isDefault: true, isActive: true, status: 'ACTIVE' },
    });
    userId = (
      await prisma.user.create({
        data: { id: randomUUID(), email: `it-pco-${runId}@it.example.com` },
      })
    ).id;

    const item = async (
      lab: string,
      kind: 'TEST' | 'PACKAGE',
      name: string,
      packageComponentOnly = false
    ) =>
      (
        await prisma.catalogItem.create({
          data: { labTenantId: lab, kind, name, packageComponentOnly },
        })
      ).id;
    visible = await item(labId, 'TEST', 'Albumina');
    for (const n of [1, 2, 3]) {
      copro.push(await item(labId, 'TEST', `Copro mx ${n}`, true));
    }
    packageId = await item(labId, 'PACKAGE', 'Coprológico seriado');
    await prisma.catalogItemComposition.createMany({
      data: copro.map((componentId) => ({ packageId, componentId })),
    });
  });

  afterAll(async () => {
    for (const id of [clinicId, labId, otherLabId]) {
      await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('the clinic sees the package and ordinary tests, not the package-only ones', async () => {
    const list = await catalog.findAll(clinicId);
    const names = list.map((i) => i.name).sort();
    expect(names).toEqual(['Albumina', 'Coprológico seriado']);
  });

  it('the package still carries its components, flagged or not', async () => {
    const pkg = (await catalog.findAll(clinicId)).find(
      (i) => i.id === packageId
    ) as { components?: Array<{ name: string }> };
    expect(pkg.components?.map((c) => c.name).sort()).toEqual([
      'Copro mx 1',
      'Copro mx 2',
      'Copro mx 3',
    ]);
  });

  it('the lab sees everything, with the flag', async () => {
    const res = await catalog.findAllAdmin(labId, { pageSize: 50 });
    expect(res.total).toBe(5);
    const flagged = res.data
      .filter((i) => i.packageComponentOnly)
      .map((i) => i.name)
      .sort();
    expect(flagged).toEqual(['Copro mx 1', 'Copro mx 2', 'Copro mx 3']);
  });

  it('a clinic cannot pick a package-only test by id', async () => {
    const caseId = await newCase();
    await expect(
      cases.selectCatalogItems(clinicId, caseId, {
        selectedCatalogItemIds: [copro[0]],
      } as never)
    ).rejects.toThrow(/invalid or inactive/);
    expect(await prisma.caseCatalogItem.count({ where: { caseId } })).toBe(0);
  });

  it('a clinic can pick the package and ordinary tests', async () => {
    const caseId = await newCase();
    await cases.selectCatalogItems(clinicId, caseId, {
      selectedCatalogItemIds: [packageId, visible],
    } as never);
    expect(await prisma.caseCatalogItem.count({ where: { caseId } })).toBe(2);
  });

  it('un-flagging makes the test visible again; the flag is per item', async () => {
    await catalog.updateItem(labId, copro[2], { packageComponentOnly: false });
    expect((await catalog.findAll(clinicId)).map((i) => i.name).sort()).toEqual(
      ['Albumina', 'Coprológico seriado', 'Copro mx 3'].sort()
    );
    await catalog.updateItem(labId, copro[2], { packageComponentOnly: true });
  });

  it("another lab cannot flag this lab's tests", async () => {
    await expect(
      catalog.updateItem(otherLabId, copro[0], { packageComponentOnly: false })
    ).rejects.toThrow(/not found/i);
    expect(
      (await prisma.catalogItem.findUniqueOrThrow({ where: { id: copro[0] } }))
        .packageComponentOnly
    ).toBe(true);
  });

  it('a package cannot be flagged', async () => {
    await expect(
      catalog.updateItem(labId, packageId, { packageComponentOnly: true })
    ).rejects.toThrow(/only a test/i);
  });
});
