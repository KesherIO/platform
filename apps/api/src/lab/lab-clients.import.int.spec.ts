/**
 * Concurrency checks for client creation against a real Postgres (plan B6).
 * Mocked unit tests can't prove the per-lab advisory lock works; this can.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set. Point it at a throwaway
 * database with the migrations applied (local Postgres or a disposable
 * Supabase branch) — never at dev or prod:
 *
 *   cd apps/api && INTEGRATION_DATABASE_URL=postgres://… \
 *     node ../../node_modules/.bin/jest --config jest.config.js lab-clients.import.int
 *
 * Creates its own lab tenant and deletes everything it created afterwards.
 */
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LabClientsService } from './lab-clients.service';
import type { ImportClientsDto } from './dto/import-clients.dto';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('LabClientsService against Postgres (concurrency)', () => {
  let prisma: PrismaService;
  let service: LabClientsService;
  let labId: string;
  const runId = randomUUID().slice(0, 8);

  const rows = (count: number, prefix = 'clinic') =>
    Array.from({ length: count }, (_, i) => ({
      rowNumber: i + 2,
      name: `IT ${runId} ${prefix} ${i}`,
      clientType: 'VETERINARY_CLINIC',
      primaryContactEmail: `${prefix}-${i}-${runId}@it.example.com`,
      country: 'CO',
    }));
  const body = (
    r: Record<string, unknown>[],
    importBatchId = randomUUID()
  ): ImportClientsDto => ({ importBatchId, rows: r });

  const clientsOfLab = () =>
    prisma.clinicLabConnection.count({ where: { labId } });

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    service = new LabClientsService(prisma);
  });

  beforeEach(async () => {
    const lab = await prisma.tenant.create({
      data: {
        name: `IT lab ${runId}`,
        slug: `it-lab-${randomUUID()}`,
        type: 'LAB',
      },
    });
    labId = lab.id;
  });

  afterEach(async () => {
    const connections = await prisma.clinicLabConnection.findMany({
      where: { labId },
      select: { clinicId: true },
    });
    await prisma.onboardingToken.deleteMany({ where: { laboratoryId: labId } });
    await prisma.tenant.deleteMany({
      where: { id: { in: [...connections.map((c) => c.clinicId), labId] } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('two imports of the same 25 rows at the same time create 25 clients', async () => {
    const same = rows(25);

    const [a, b] = await Promise.all([
      service.importClients(labId, body(same), 'it-user'),
      service.importClients(labId, body(same), 'it-user'),
    ]);

    expect(await clientsOfLab()).toBe(25);
    expect(a.summary.created + b.summary.created).toBe(25);
    expect(a.summary.skipped + b.summary.skipped).toBe(25);
    expect(a.summary.failed + b.summary.failed).toBe(0);
  });

  it('an import and an Add client with the same email at the same time create one client', async () => {
    const [row] = rows(1, 'race');

    const [imported, added] = await Promise.allSettled([
      service.importClients(labId, body([row]), 'it-user'),
      service.createClient(
        labId,
        {
          name: row.name,
          clientType: row.clientType,
          primaryContactEmail: row.primaryContactEmail.toUpperCase(),
        },
        'it-user'
      ),
    ]);

    expect(await clientsOfLab()).toBe(1);
    const importCreated =
      imported.status === 'fulfilled' && imported.value.summary.created === 1;
    const addCreated = added.status === 'fulfilled';
    expect(importCreated !== addCreated).toBe(true); // exactly one won
  });

  it('the same group sent twice with the same batch id creates 25 clients, both say created', async () => {
    const group = body(rows(25, 'replay'));

    const first = await service.importClients(labId, group, 'it-user');
    const second = await service.importClients(labId, group, 'it-user');

    expect(await clientsOfLab()).toBe(25);
    expect(first.summary.created).toBe(25);
    expect(second.summary.created).toBe(25);
    expect(second.results).toEqual(first.results);
  });

  it('the same group sent twice at the same time with the same batch id creates 25 clients', async () => {
    const group = body(rows(25, 'parallel-replay'));

    const [a, b] = await Promise.all([
      service.importClients(labId, group, 'it-user'),
      service.importClients(labId, group, 'it-user'),
    ]);

    expect(await clientsOfLab()).toBe(25);
    expect(a.summary.created).toBe(25);
    expect(b.summary.created).toBe(25);
  });
});
