/**
 * Accessioning with a sample "not received yet" against a real Postgres: the
 * serial-test case (copro 1 / 2 / 3, each with its own container). Real
 * services and templates; only notifications are replaced, to prove none are
 * sent. Skipped unless INTEGRATION_DATABASE_URL is set (throwaway database
 * only, see result-entry.batch.int.spec.ts).
 */
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { OrderStatusService } from './order-status.service';
import { SpecimenService } from './specimen.service';
import type { NotificationService } from '../notifications/notification.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Accession with samples not received yet (Postgres)', () => {
  let prisma: PrismaService;
  let service: SpecimenService;
  const notifications = { publish: jest.fn(), deliverQueued: jest.fn() };
  const runId = randomUUID().slice(0, 8);
  let labId: string;
  let otherLabId: string;
  let clinicId: string;
  let userId: string;
  const catalog: Record<string, string> = {};
  // Accession numbers are unique per lab: one prefix per order created
  let orderSeq = 0;

  const tube = (n: 1 | 2 | 3, patch: Record<string, unknown> = {}) => ({
    specimenType: 'FECES',
    containerType: `FRASCO_COPRO_${n}_${runId}`,
    tubeIndex: 1,
    accessionNumber: `REQ-${runId}-${orderSeq}-${n}`,
    accepted: false,
    ...patch,
  });

  async function newOrder() {
    orderSeq++;
    const kase = await prisma.case.create({
      data: {
        tenantId: clinicId,
        patientName: `Copro ${runId}`,
        patientSpecies: 'DOG',
        ownerName: 'Owner',
        createdByUserId: userId,
      },
    });
    const order = await prisma.order.create({
      data: {
        requisitionNumber: `IT-${randomUUID().slice(0, 8)}`,
        caseId: kase.id,
        tenantId: clinicId,
        labTenantId: labId,
        orderedItems: [],
        status: 'PENDING',
      },
    });
    const tests: Record<string, string> = {};
    for (const code of ['c1', 'c2', 'c3']) {
      tests[code] = (
        await prisma.orderedTest.create({
          data: {
            orderId: order.id,
            catalogItemId: catalog[code],
            catalogItemCode: `${code}-${runId}`,
            catalogItemName: `Copro ${code}`,
          },
        })
      ).id;
    }
    return { orderId: order.id, tests };
  }

  const test = (id: string) =>
    prisma.orderedTest.findUniqueOrThrow({ where: { id } });
  const specimens = (orderId: string) =>
    prisma.specimen.findMany({
      where: { orderId },
      orderBy: { accessionNumber: 'asc' },
    });
  const accession = (orderId: string, rows: Record<string, unknown>[]) =>
    service.accessionOrder(
      orderId,
      labId,
      { specimens: rows } as never,
      userId,
      'Ana'
    );

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    service = new SpecimenService(
      prisma,
      new TemplateVersionService(prisma),
      new OrderStatusService(prisma),
      notifications as unknown as NotificationService
    );

    labId = (
      await prisma.tenant.create({
        data: { name: `IT lab ${runId}`, slug: `it-acc-lab-${runId}`, type: 'LAB' },
      })
    ).id;
    otherLabId = (
      await prisma.tenant.create({
        data: { name: `IT lab2 ${runId}`, slug: `it-acc-lab2-${runId}`, type: 'LAB' },
      })
    ).id;
    clinicId = (
      await prisma.tenant.create({
        data: { name: `IT clinic ${runId}`, slug: `it-acc-clinic-${runId}` },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: { id: randomUUID(), email: `it-acc-${runId}@it.example.com` },
      })
    ).id;

    // Three coprológicos, each with its own container, and a published template
    for (const [i, code] of (['c1', 'c2', 'c3'] as const).entries()) {
      const item = await prisma.catalogItem.create({
        data: {
          labTenantId: labId,
          kind: 'TEST',
          code: `${code}-${runId}`,
          name: `Copro ${code}`,
        },
      });
      catalog[code] = item.id;
      await prisma.labTestConfiguration.create({
        data: {
          labTenantId: labId,
          catalogItemId: item.id,
          department: 'PARASITOLOGY',
          specimenRequirements: {
            create: {
              specimenType: 'FECES',
              containerType: `FRASCO_COPRO_${i + 1}_${runId}`,
              requirementGroupKey: 'primary',
            },
          },
        },
      });
      const def = await prisma.resultTemplateDefinition.create({
        data: {
          catalogItemCode: `${code}-${runId}`,
          species: 'DOG',
          scope: 'LABORATORY',
          labTenantId: labId,
          ownerKey: labId,
        },
      });
      const version = await prisma.resultTemplateVersion.create({
        data: {
          definitionId: def.id,
          version: 1,
          title: 'Coprológico',
          status: 'PUBLISHED',
        },
      });
      await prisma.resultTemplateDefinition.update({
        where: { id: def.id },
        data: { activeVersionId: version.id },
      });
    }
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    // Clinic first (its cases/orders cascade), then the labs and the user
    for (const id of [clinicId, labId, otherLabId]) {
      await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.resultTemplateDefinition
      .deleteMany({ where: { catalogItemCode: { endsWith: runId } } })
      .catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('day 1: receives copro 1 and leaves copro 2 and 3 waiting — nothing rejected, nobody notified', async () => {
    const { orderId, tests } = await newOrder();

    const res = await accession(orderId, [
      tube(1, { accepted: true }),
      tube(2, { awaiting: true }),
      tube(3, { awaiting: true }),
    ]);

    expect((await test(tests['c1'])).status).toBe('READY');
    const c2 = await test(tests['c2']);
    const c3 = await test(tests['c3']);
    expect([c2.status, c3.status]).toEqual(['PENDING', 'PENDING']);
    expect([c2.blockReason, c3.blockReason]).toEqual([null, null]);
    // not stamped as received: they have not arrived
    expect([c2.receivedAt, c3.receivedAt]).toEqual([null, null]);
    expect((await test(tests['c1'])).receivedAt).not.toBeNull();

    const sp = await specimens(orderId);
    expect(sp.map((s) => s.status)).toEqual(['ACCEPTED', 'EXPECTED', 'EXPECTED']);
    expect(sp[1].receivedAt).toBeNull();
    expect(sp[1].isInsufficient).toBe(false);
    expect(sp[1].rejectionReason).toBeNull();

    // each waiting test is linked to its own expected tube
    const links = await prisma.orderedTestSpecimen.findMany({
      where: { orderedTestId: { in: [tests['c2'], tests['c3']] } },
    });
    expect(
      links
        .map((l) => [l.orderedTestId, l.specimenId])
        .sort()
    ).toEqual(
      [
        [tests['c2'], sp[1].id],
        [tests['c3'], sp[2].id],
      ].sort()
    );

    expect(res.order.status).toBe('RECEIVED_BY_LAB');
    const events = await prisma.timelineEvent.findMany({ where: { orderId } });
    expect(events.map((e) => e.eventType)).not.toContain('SAMPLE_REJECTED');
    expect(
      events.find((e) => e.eventType === 'SAMPLE_ACCESSIONED')?.description
    ).toContain('2 not received yet');
    expect(notifications.publish).not.toHaveBeenCalled();
  });

  it('day 3: receiving the awaited tube readies only its own test', async () => {
    const { orderId, tests } = await newOrder();
    await accession(orderId, [
      tube(1, { accepted: true }),
      tube(2, { awaiting: true }),
      tube(3, { awaiting: true }),
    ]);
    const [, tube2] = await specimens(orderId);

    const received = await service.receiveSpecimen(
      tube2.id,
      labId,
      { accepted: true } as never,
      userId,
      'Ana'
    );

    expect(received.specimen.status).toBe('ACCEPTED');
    const c2 = await test(tests['c2']);
    expect(c2.status).toBe('READY');
    expect(c2.receivedAt).not.toBeNull();
    // copro 3 is still waiting for its own tube
    const c3 = await test(tests['c3']);
    expect([c3.status, c3.receivedAt]).toEqual(['PENDING', null]);
  });

  it('reopening the dialog while a tube is still awaited changes nothing and duplicates nothing', async () => {
    const { orderId, tests } = await newOrder();
    const rows = [
      tube(1, { accepted: true }),
      tube(2, { awaiting: true }),
      tube(3, { awaiting: true }),
    ];
    await accession(orderId, rows);
    await accession(orderId, rows);

    expect(await specimens(orderId)).toHaveLength(3);
    expect((await test(tests['c1'])).status).toBe('READY');
    expect((await test(tests['c2'])).status).toBe('PENDING');
  });

  it('a later accession can receive an awaited tube through the dialog too', async () => {
    const { orderId, tests } = await newOrder();
    await accession(orderId, [
      tube(1, { accepted: true }),
      tube(2, { awaiting: true }),
    ]);
    await accession(orderId, [
      tube(1, { accepted: true }),
      tube(2, { accepted: true }),
    ]);
    expect((await test(tests['c2'])).status).toBe('READY');
    const sp = await specimens(orderId);
    expect(sp.map((s) => s.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(sp[1].receivedAt).not.toBeNull();
  });

  it('refuses an accession where nothing is received, and writes nothing', async () => {
    const { orderId } = await newOrder();
    await expect(
      accession(orderId, [tube(1, { awaiting: true }), tube(2, { awaiting: true })])
    ).rejects.toThrow(/at least one sample/i);
    expect(await specimens(orderId)).toHaveLength(0);
  });

  it('refuses to un-receive a tube that was already received', async () => {
    const { orderId } = await newOrder();
    await accession(orderId, [tube(1, { accepted: true }), tube(2, { accepted: true })]);
    await expect(
      accession(orderId, [tube(1, { awaiting: true }), tube(2, { accepted: true })])
    ).rejects.toThrow(/already received/i);
    expect((await specimens(orderId)).map((s) => s.status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
    ]);
  });

  it("another lab cannot accession this lab's order", async () => {
    const { orderId } = await newOrder();
    await expect(
      service.accessionOrder(
        orderId,
        otherLabId,
        { specimens: [tube(1, { accepted: true })] } as never,
        userId,
        'Eve'
      )
    ).rejects.toThrow(/not found/i);
    expect(await specimens(orderId)).toHaveLength(0);
  });
});
