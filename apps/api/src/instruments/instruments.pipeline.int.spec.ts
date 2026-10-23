/**
 * The analyzer pipeline against a real Postgres, driven by the REAL VH-30
 * capture (docs/VH30-test.hl7): upload → dedupe → explicit sample match →
 * unit-validated mapping → draft import through ResultEntryService, plus the
 * review queue (unmatched, ambiguous, changed, expired reagent, incomplete).
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set — a throwaway database with the
 * schema applied, never dev or prod (same convention as result-entry.batch.int.spec.ts):
 *
 *   cd apps/api && INTEGRATION_DATABASE_URL=postgres://… \
 *     node ../../node_modules/.bin/jest --config jest.config.js instruments.pipeline.int
 *
 * Creates its own labs, analyzers, orders and template, and deletes them after.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ResultEntryService } from '../lab/result-entry.service';
import { TemplateVersionService } from '../results/template-version.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { InstrumentIngestService } from './instrument-ingest.service';
import { InstrumentProcessorService } from './instrument-processor.service';
import { InstrumentReviewService } from './instrument-review.service';
import { OrderMatchService } from './order-match.service';
import { hasCapture, realFrames, rewriteFrame } from './test-frames';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL && hasCapture ? describe : describe.skip;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describeWithDb('Analyzer pipeline against Postgres (real VH-30 frames)', () => {
  let prisma: PrismaService;
  let credentials: ConnectorCredentialService;
  let ingest: InstrumentIngestService;
  let review: InstrumentReviewService;
  let resultEntry: ResultEntryService;
  const runId = randomUUID().slice(0, 8);
  // Jest runs this body even when skipped, and the capture is gitignored (absent in CI)
  const frames = hasCapture ? realFrames() : []; // 168, 169, 168 resend, 1111, 1111 resend
  const SAMPLE_1111 = frames[3];
  const CATALOG = `CBC-${runId}`;

  let labId: string;
  let labBId: string;
  let labCId: string; // its template computes MCV by formula
  let clinicId: string;
  let userId: string;
  const created = {
    orders: [] as string[],
    cases: [] as string[],
    defs: [] as string[],
  };

  async function labWithTemplate(
    name: string,
    timezone = 'America/Bogota',
    formulaMcv = false
  ) {
    const lab = await prisma.tenant.create({
      data: {
        name: `IT ${name} ${runId}`,
        slug: `it-${name}-${runId}`,
        type: 'LAB',
        timezone,
      },
    });
    const def = await prisma.resultTemplateDefinition.create({
      data: {
        catalogItemCode: CATALOG,
        species: 'DOG',
        scope: 'LABORATORY',
        labTenantId: lab.id,
        ownerKey: lab.id,
      },
    });
    created.defs.push(def.id);
    const version = await prisma.resultTemplateVersion.create({
      data: {
        definitionId: def.id,
        version: 1,
        title: 'CBC',
        status: 'PUBLISHED',
      },
    });
    await prisma.resultTemplateDefinition.update({
      where: { id: def.id },
      data: { activeVersionId: version.id },
    });
    let order = 0;
    for (const code of ['RBC', 'HGB', 'HCT', 'WBC', 'PLT', 'LYM', 'LYM_PCT']) {
      await prisma.resultTemplateAnalyte.create({
        data: {
          versionId: version.id,
          code,
          name: code,
          valueType: 'NUMERIC',
          sortOrder: ++order,
        },
      });
    }
    if (formulaMcv) {
      await prisma.resultTemplateAnalyte.create({
        data: {
          versionId: version.id,
          code: 'MCV',
          name: 'MCV',
          valueType: 'NUMERIC',
          sortOrder: ++order,
          formula: '([HCT]*10)/[RBC]',
        },
      });
    }
    return lab.id;
  }

  async function newOrder(forLab: string, testStatus = 'READY') {
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
        labTenantId: forLab,
        orderedItems: [],
      },
    });
    created.orders.push(order.id);
    const test = await prisma.orderedTest.create({
      data: {
        orderId: order.id,
        catalogItemName: 'Hemograma',
        catalogItemCode: CATALOG,
        status: testStatus as never,
      },
    });
    return { order, test };
  }

  /** A fresh analyzer + credential + the explicit parameter mappings, so scenarios never share dedupe state. */
  async function newRig(forLab = labId, label = 'rig') {
    const analyzer = await prisma.analyzer.create({
      data: {
        labTenantId: forLab,
        name: `VH30 ${label} ${randomUUID().slice(0, 6)}`,
        department: 'HEMATOLOGY',
      },
    });
    const credential = await credentials.create(
      forLab,
      analyzer.id,
      'it connector',
      userId
    );
    const connector = (await credentials.authenticate(credential.token))!;
    const map = (
      parameterCode: string,
      analyzerUnit: string,
      analyteCode: string,
      multiplier = 1
    ) =>
      prisma.instrumentParameterMapping.create({
        data: {
          labTenantId: forLab,
          analyzerId: analyzer.id,
          parameterCode,
          analyzerUnit,
          catalogItemCode: CATALOG,
          analyteCode,
          multiplier,
        },
      });
    await Promise.all([
      map('WBC', '10^9/L', 'WBC'),
      map('RBC', '10^12/L', 'RBC'),
      map('HGB', 'g/dL', 'HGB'),
      map('HCT', '%', 'HCT'),
      map('PLT', '10^9/L', 'PLT'),
      map('Lym#', '10^9/L', 'LYM'),
      map('Lym%', '%', 'LYM_PCT'),
      ...(forLab === labCId ? [map('MCV', 'fL', 'MCV')] : []),
    ]);
    const { order, test } = await newOrder(forLab);
    return { analyzer, credential, connector, order, test, labId: forLab };
  }
  type Rig = Awaited<ReturnType<typeof newRig>>;

  const upload = (
    rig: Rig,
    bytes: Buffer,
    extra: Partial<{ complete: boolean; incompleteReason: string }> = {}
  ) =>
    ingest.ingest({
      connector: rig.connector,
      bytes,
      claimedSha256: sha(bytes),
      receivedAt: new Date(),
      complete: true,
      ...extra,
    });

  /** Link sample 1111 (observed 2026-10-20 09:29 Bogota) to the rig's order. */
  const link = (rig: Rig, sampleId = '1111') =>
    review.createLink(
      rig.labId,
      {
        analyzerId: rig.analyzer.id,
        sampleId,
        orderId: rig.order.id,
        validFrom: new Date('2026-10-19T00:00:00Z'),
        validUntil: new Date('2026-10-22T00:00:00Z'),
      },
      userId
    );

  const analyteValues = async (testId: string) =>
    Object.fromEntries(
      (
        await prisma.resultReportAnalyte.findMany({
          where: { reportTest: { orderedTestId: testId } },
          select: { code: true, numericValue: true },
        })
      ).map((a) => [a.code, a.numericValue])
    );
  const message = (id: string) =>
    prisma.instrumentMessage.findUniqueOrThrow({ where: { id } });
  const messageCount = (rig: Rig) =>
    prisma.instrumentMessage.count({ where: { analyzerId: rig.analyzer.id } });

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    resultEntry = new ResultEntryService(
      prisma,
      new TemplateVersionService(prisma)
    );
    const processor = new InstrumentProcessorService(
      prisma,
      resultEntry,
      new OrderMatchService(prisma)
    );
    credentials = new ConnectorCredentialService(prisma);
    ingest = new InstrumentIngestService(prisma, processor);
    review = new InstrumentReviewService(prisma, processor);

    labId = await labWithTemplate('a');
    labBId = await labWithTemplate('b');
    labCId = await labWithTemplate('c', 'America/Bogota', true);
    clinicId = (
      await prisma.tenant.create({
        data: { name: `IT clinic ${runId}`, slug: `it-clinic-${runId}` },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: { id: randomUUID(), email: `it-${runId}@it.example.com` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.instrumentMessage.deleteMany({
      where: { labTenantId: { in: [labId, labBId, labCId] } },
    });
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
      where: { id: { in: [labId, labBId, labCId, clinicId] } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── Credentials ──────────────────────────────────────────────────────────

  describe('connector credentials', () => {
    it('authenticates only while valid, is bound to one lab + analyzer, and is revocable', async () => {
      const rig = await newRig();
      expect(rig.connector).toMatchObject({
        labTenantId: labId,
        analyzerId: rig.analyzer.id,
      });
      expect(
        await credentials.authenticate(rig.credential.token.slice(0, -1) + 'x')
      ).toBeNull();
      expect(await credentials.authenticate('nonsense')).toBeNull();

      await credentials.revoke(labId, rig.credential.id, userId);
      expect(await credentials.authenticate(rig.credential.token)).toBeNull();
      await expect(
        credentials.revoke(labId, rig.credential.id, userId)
      ).resolves.toBeTruthy(); // idempotent
    });

    it('stores only a hash of the token', async () => {
      const rig = await newRig();
      const row = await prisma.connectorCredential.findUniqueOrThrow({
        where: { id: rig.credential.id },
      });
      expect(JSON.stringify(row)).not.toContain(rig.credential.token);
      expect(row.tokenHash).toHaveLength(64);
    });

    it('cannot be created for, or revoked in, another lab', async () => {
      const rig = await newRig();
      await expect(
        credentials.create(labBId, rig.analyzer.id, 'x', userId)
      ).rejects.toThrow(NotFoundException);
      await expect(
        credentials.revoke(labBId, rig.credential.id, userId)
      ).rejects.toThrow(NotFoundException);
      expect(
        await credentials.authenticate(rig.credential.token)
      ).not.toBeNull();
    });
  });

  // ── Ingest, dedupe, explicit matching, draft import ──────────────────────

  describe('upload → unmatched → resolve → draft', () => {
    it('keeps the exact bytes, never guesses an order from the sample ID, and imports only as a DRAFT', async () => {
      const rig = await newRig();
      const first = await upload(rig, SAMPLE_1111);
      expect(first).toMatchObject({
        status: 'UNMATCHED',
        duplicateUpload: false,
      });

      const raw = await review.raw(labId, first.id);
      expect(raw.bytes.equals(SAMPLE_1111)).toBe(true);

      // A retry of the same bytes is recognised, nothing new is stored
      const again = await upload(rig, SAMPLE_1111);
      expect(again).toMatchObject({ id: first.id, duplicateUpload: true });
      expect(await messageCount(rig)).toBe(1);

      // Staff link the analyzer sample to the order → processed
      const resolved = await review.resolveSample(
        labId,
        first.id,
        rig.order.id,
        userId
      );
      expect(resolved.status).toBe('IMPORTED');

      expect(await analyteValues(rig.test.id)).toEqual({
        WBC: 71.36,
        RBC: 2.77,
        HGB: 5.7,
        HCT: 19,
        PLT: 317,
        LYM: 7.64,
        LYM_PCT: 10.7,
      });
      const report = await prisma.resultReport.findUniqueOrThrow({
        where: { orderId: rig.order.id },
      });
      expect(report.status).toBe('DRAFT'); // review + release rules untouched
      const test = await prisma.orderedTest.findUniqueOrThrow({
        where: { id: rig.test.id },
      });
      expect(test).toMatchObject({
        status: 'IN_PROGRESS',
        entryMethod: 'INSTRUMENT',
        resultEntrySource: 'DIRECT_INTEGRATION',
        analyzerId: rig.analyzer.id,
      });
      const events = await prisma.timelineEvent.findMany({
        where: { orderId: rig.order.id },
        select: { eventType: true },
      });
      expect(events.map((e) => e.eventType)).toContain(
        'INSTRUMENT_RESULTS_IMPORTED'
      );

      const stored = await message(first.id);
      expect(stored).toMatchObject({
        status: 'IMPORTED',
        importedCount: 7,
        orderId: rig.order.id,
        hasExpiredReagent: false,
      });
      expect(stored.observationTime?.toISOString()).toBe(
        '2026-10-20T14:29:38.000Z'
      ); // 09:29:38 in Bogota
    });

    it('a resend (same result, new MSH-7) is a DUPLICATE: nothing re-imported or re-queued', async () => {
      const rig = await newRig();
      await link(rig);
      const first = await upload(rig, frames[3]);
      expect(first.status).toBe('IMPORTED');
      const resend = await upload(rig, frames[4]);
      expect(resend.status).toBe('DUPLICATE');
      expect((await message(resend.id)).previousMessageId).toBe(first.id);
      expect(await review.summary(labId)).toBeDefined();
    });

    it('rejects a tampered body and stores nothing', async () => {
      const rig = await newRig();
      await expect(
        ingest.ingest({
          connector: rig.connector,
          bytes: SAMPLE_1111,
          claimedSha256: 'a'.repeat(64),
          receivedAt: new Date(),
          complete: true,
        })
      ).rejects.toThrow(BadRequestException);
      expect(await messageCount(rig)).toBe(0);
    });

    it('does not match a link whose time window excludes the run (analyzers reuse sample IDs)', async () => {
      const rig = await newRig();
      await review.createLink(
        labId,
        {
          analyzerId: rig.analyzer.id,
          sampleId: '1111',
          orderId: rig.order.id,
          validFrom: new Date('2030-01-01'),
          validUntil: new Date('2030-01-02'),
        },
        userId
      );
      expect((await upload(rig, SAMPLE_1111)).status).toBe('UNMATCHED');
    });

    it('an unparseable "complete" upload is stored FAILED, not dropped', async () => {
      const rig = await newRig();
      const junk = Buffer.from('this is not a frame');
      const r = await upload(rig, junk);
      expect(r.status).toBe('FAILED');
      expect((await review.raw(labId, r.id)).bytes.equals(junk)).toBe(true);
    });
  });

  // ── Changed results and OBX-13 flags ─────────────────────────────────────

  describe('changed results and flags', () => {
    it('detects an edited result by payload content, holds it for review, and applies it only when approved', async () => {
      const rig = await newRig();
      await link(rig);
      expect((await upload(rig, frames[3])).status).toBe('IMPORTED');

      // Same control ID, new transmission time, WBC edited on the analyzer
      const edited = rewriteFrame(frames[3], (t) =>
        t.replace('71.36', '65.10').replace('20261020092943', '20261020101500')
      );
      const r = await upload(rig, edited);
      expect(r.status).toBe('NEEDS_REVIEW');
      const row = await message(r.id);
      expect(row.reasons).toEqual(['CONTENT_CHANGED']);
      expect(
        (
          row.diff as {
            changed: Array<{ code: string; after: { value: string } }>;
          }
        ).changed.map((c) => [c.code, c.after.value])
      ).toEqual([['WBC', '65.10']]);
      expect((await analyteValues(rig.test.id)).WBC).toBe(71.36); // draft untouched

      await expect(
        review.approve(
          labId,
          r.id,
          { id: userId, name: 'Rev' },
          ['EXPIRED_REAGENT'],
          'wrong reason'
        )
      ).rejects.toThrow(BadRequestException);
      expect(
        (
          await review.approve(
            labId,
            r.id,
            { id: userId, name: 'Rev' },
            ['CONTENT_CHANGED'],
            'Re-run confirmed by supervisor'
          )
        ).status
      ).toBe('IMPORTED');
      expect((await analyteValues(rig.test.id)).WBC).toBe(65.1);
      expect(await message(r.id)).toMatchObject({
        reviewedById: userId,
        reviewNote: 'Re-run confirmed by supervisor',
      });
    });

    it('treats an expired-reagent flag (OBX-13 = O) as its own review reason, separate from analyzer edits', async () => {
      const expired = await newRig();
      await link(expired);
      const withO = rewriteFrame(frames[3], (t) =>
        t.replace(
          '||F||||||||\rOBX|2|NM|^Lym#^',
          '||F||O|||||\rOBX|2|NM|^Lym#^'
        )
      );
      const r = await upload(expired, withO);
      expect(r.status).toBe('NEEDS_REVIEW');
      expect(await message(r.id)).toMatchObject({
        reasons: ['EXPIRED_REAGENT'],
        hasExpiredReagent: true,
        hasAnalyzerEdits: false,
      });
      expect(await analyteValues(expired.test.id)).toEqual({}); // nothing written
      expect(
        (
          await review.approve(
            labId,
            r.id,
            { id: userId, name: 'Rev' },
            ['EXPIRED_REAGENT'],
            'Reagent lot checked, values verified'
          )
        ).status
      ).toBe('IMPORTED');

      const edited = await newRig();
      await link(edited);
      const withE = rewriteFrame(frames[3], (t) =>
        t.replace(
          '||F||||||||\rOBX|2|NM|^Lym#^',
          '||F||E|||||\rOBX|2|NM|^Lym#^'
        )
      );
      const e = await upload(edited, withE);
      // Edited on the analyzer: flag retained and shown, not an expired reagent, not blocked by itself
      expect(e.status).toBe('IMPORTED');
      expect(await message(e.id)).toMatchObject({
        hasAnalyzerEdits: true,
        hasExpiredReagent: false,
        reasons: [],
      });
      expect(
        (
          (await message(e.id)).parsed as {
            parameters: Array<{ code: string; userFlag: string }>;
          }
        ).parameters.find((p) => p.code === 'WBC')?.userFlag
      ).toBe('E');
    });
  });

  // ── Mapping + unit validation ────────────────────────────────────────────

  describe('parameter mapping and units', () => {
    it('a unit with no mapping is NOT imported; adding an explicit conversion and reprocessing imports it converted', async () => {
      const rig = await newRig();
      await link(rig);
      const gPerL = rewriteFrame(frames[3], (t) =>
        t.replace('OBX|9|NM|^HGB^||5.7|g/dL|', 'OBX|9|NM|^HGB^||57|g/L|')
      );
      const r = await upload(rig, gPerL);
      expect(r.status).toBe('NEEDS_REVIEW');
      expect((await message(r.id)).reasons).toEqual(['UNIT_MISMATCH:HGB:g/L']);
      expect(await analyteValues(rig.test.id)).toEqual({});
      // Approving can't skip a unit problem
      await expect(
        review.approve(
          labId,
          r.id,
          { id: userId, name: 'Rev' },
          ['CONTENT_CHANGED'],
          'try'
        )
      ).rejects.toThrow(BadRequestException);

      await review.upsertMapping(labId, {
        analyzerId: rig.analyzer.id,
        parameterCode: 'HGB',
        analyzerUnit: 'g/L',
        catalogItemCode: CATALOG,
        analyteCode: 'HGB',
        multiplier: 0.1,
      });
      expect((await review.reprocess(labId, r.id)).status).toBe('IMPORTED');
      expect((await analyteValues(rig.test.id)).HGB).toBe(5.7);
    });

    it('unmapped parameters (Mid#, Gran#, alarms, images) are ignored and listed, not imported', async () => {
      const rig = await newRig();
      await link(rig);
      const r = await upload(rig, frames[3]);
      const { import: info } = (await message(r.id)).parsed as {
        import: { ignored: Array<{ code: string; reason: string }> };
      };
      const ignored = Object.fromEntries(
        info.ignored.map((i) => [i.code, i.reason])
      );
      expect(ignored['Mid#']).toBe('NO_MAPPING');
      expect(ignored['Gran#']).toBe('NO_MAPPING');
      expect(ignored['WBC Alarm']).toBe('NOT_NUMERIC');
    });
  });

  // ── Interrupted transfers ────────────────────────────────────────────────

  describe('interrupted transfers', () => {
    it('are kept, marked INCOMPLETE and never imported — even when a link exists', async () => {
      const rig = await newRig();
      await link(rig);
      const truncated = SAMPLE_1111.subarray(0, 40_000);
      const r = await upload(rig, Buffer.from(truncated), {
        complete: false,
        incompleteReason: 'trailing-partial',
      });
      expect(r.status).toBe('INCOMPLETE');
      const row = await message(r.id);
      expect(row).toMatchObject({
        isComplete: false,
        incompleteReason: 'trailing-partial',
        reasons: ['INCOMPLETE_TRANSFER'],
        controlId: '2580',
        sampleId: '1111',
      });
      expect(await analyteValues(rig.test.id)).toEqual({});
      expect((await review.raw(labId, r.id)).bytes.equals(truncated)).toBe(
        true
      );
      await expect(
        review.resolveSample(labId, r.id, rig.order.id, userId)
      ).rejects.toThrow(BadRequestException);
      await expect(review.reprocess(labId, r.id)).rejects.toThrow(
        ConflictException
      );
      expect((await review.summary(labId)).incomplete).toBeGreaterThan(0);

      // The complete resend arrives: the interrupted attempt no longer needs attention, but stays INCOMPLETE
      expect((await upload(rig, SAMPLE_1111)).status).toBe('IMPORTED');
      expect(await message(r.id)).toMatchObject({
        status: 'INCOMPLETE',
        isComplete: false,
      });
      expect((await message(r.id)).resolvedAt).not.toBeNull();
    });

    it('can be acknowledged without being relabelled', async () => {
      const rig = await newRig();
      const r = await upload(rig, Buffer.from(SAMPLE_1111.subarray(0, 100)), {
        complete: false,
      });
      expect(
        (await review.dismiss(labId, r.id, userId, 'Cable was unplugged'))
          .status
      ).toBe('INCOMPLETE');
      expect(await message(r.id)).toMatchObject({
        status: 'INCOMPLETE',
        reviewNote: 'Cable was unplugged',
      });
    });
  });

  // ── Links, ambiguity, isolation ──────────────────────────────────────────

  describe('sample links', () => {
    it('refuses a second order for the same analyzer sample ID in an overlapping window; same order is idempotent', async () => {
      const rig = await newRig();
      const first = await link(rig);
      expect((await link(rig)).id).toBe(first.id);
      const other = await newOrder(labId);
      await expect(
        review.createLink(
          labId,
          {
            analyzerId: rig.analyzer.id,
            sampleId: '1111',
            orderId: other.order.id,
            validFrom: new Date('2026-10-20T00:00:00Z'),
            validUntil: new Date('2026-10-21T00:00:00Z'),
          },
          userId
        )
      ).rejects.toThrow(ConflictException);
      await review.endLink(labId, first.id);
      await expect(
        review.createLink(
          labId,
          {
            analyzerId: rig.analyzer.id,
            sampleId: '1111',
            orderId: other.order.id,
            validFrom: new Date('2026-10-20T00:00:00Z'),
            validUntil: new Date('2026-10-21T00:00:00Z'),
          },
          userId
        )
      ).resolves.toBeTruthy();
    });

    it('two overlapping links to different orders (bad data) are AMBIGUOUS, never guessed', async () => {
      const rig = await newRig();
      const other = await newOrder(labId);
      for (const orderId of [rig.order.id, other.order.id]) {
        await prisma.instrumentSampleLink.create({
          data: {
            labTenantId: labId,
            analyzerId: rig.analyzer.id,
            sampleId: '1111',
            orderId,
            validFrom: new Date('2026-10-19'),
            validUntil: new Date('2026-10-22'),
          },
        });
      }
      const r = await upload(rig, SAMPLE_1111);
      expect(r.status).toBe('AMBIGUOUS');
      expect(await analyteValues(rig.test.id)).toEqual({});
      expect(await analyteValues(other.test.id)).toEqual({});
    });
  });

  describe('lab isolation', () => {
    it("lab B cannot see, link to, or import into lab A's data", async () => {
      const a = await newRig(labId, 'A');
      const b = await newRig(labBId, 'B');
      await link(a); // A links sample 1111 to A's order

      // B's analyzer sends the same sample ID: no link in B → unmatched, A's order untouched
      const fromB = await upload(b, SAMPLE_1111);
      expect(fromB.status).toBe('UNMATCHED');
      expect(await analyteValues(a.test.id)).toEqual({});

      await expect(review.get(labId, fromB.id)).rejects.toThrow(
        NotFoundException
      );
      await expect(review.raw(labId, fromB.id)).rejects.toThrow(
        NotFoundException
      );
      await expect(
        review.resolveSample(labBId, fromB.id, a.order.id, userId)
      ).rejects.toThrow(NotFoundException); // A's order
      await expect(
        review.createLink(
          labBId,
          { analyzerId: b.analyzer.id, sampleId: '1', orderId: a.order.id },
          userId
        )
      ).rejects.toThrow(NotFoundException);
      await expect(
        review.createLink(
          labBId,
          { analyzerId: a.analyzer.id, sampleId: '1', orderId: b.order.id },
          userId
        )
      ).rejects.toThrow(NotFoundException); // A's analyzer
      const listedForA = await review.list(labId, 'all');
      expect(listedForA.items.some((m) => m.id === fromB.id)).toBe(false);
    });
  });

  // ── Protecting what staff already typed / test state ─────────────────────

  describe('fields the template computes (formula)', () => {
    it("the analyzer's figure for a formula field is not used or counted; the platform's computed value stands, and a later change raises only CONTENT_CHANGED", async () => {
      const rig = await newRig(labCId, 'formula');
      await link(rig);
      const r = await upload(rig, frames[3]); // analyzer says MCV 68.5, the template computes 19*10/2.77
      expect(r.status).toBe('IMPORTED');
      const values = await analyteValues(rig.test.id);
      expect(values.MCV).toBeCloseTo(68.592, 2); // computed from HCT and RBC — not the analyzer's 68.5
      const row = await message(r.id);
      expect(row.importedCount).toBe(7); // MCV not counted
      const info = (
        row.parsed as {
          import: {
            plan: Array<{ analyteCode: string }>;
            formulaComputed: Array<{
              analyteCode: string;
              analyzerValue: number;
            }>;
          };
        }
      ).import;
      expect(info.plan.map((p) => p.analyteCode)).not.toContain('MCV');
      expect(info.formulaComputed).toEqual([
        { analyteCode: 'MCV', analyzerCode: 'MCV', analyzerValue: 68.5 },
      ]);
      const event = await prisma.timelineEvent.findFirstOrThrow({
        where: {
          orderId: rig.order.id,
          eventType: 'INSTRUMENT_RESULTS_IMPORTED',
        },
      });
      expect(event.description).toMatch(/: 7 analyzer values/);

      // The platform-computed MCV must not look like "someone edited the draft"
      const edited = rewriteFrame(frames[3], (t) =>
        t.replace('71.36', '65.10').replace('20261020092943', '20261020101500')
      );
      const changed = await upload(rig, edited);
      expect((await message(changed.id)).reasons).toEqual(['CONTENT_CHANGED']);
    });
  });

  describe('existing work is protected', () => {
    it('does not silently overwrite manually entered values (approvable)', async () => {
      const rig = await newRig();
      await link(rig);
      const wbc = await prisma.resultTemplateAnalyte.findFirstOrThrow({
        where: { code: 'WBC', version: { definition: { labTenantId: labId } } },
      });
      await resultEntry.saveAnalytes(
        rig.test.id,
        labId,
        [{ templateAnalyteId: wbc.id, numericValue: 9 }],
        undefined,
        userId,
        'Tech'
      );

      const r = await upload(rig, SAMPLE_1111);
      expect(r.status).toBe('NEEDS_REVIEW');
      expect((await message(r.id)).reasons).toEqual(['EXISTING_MANUAL_VALUES']);
      expect((await analyteValues(rig.test.id)).WBC).toBe(9);
      expect(
        (
          await review.approve(
            labId,
            r.id,
            { id: userId, name: 'Rev' },
            ['EXISTING_MANUAL_VALUES'],
            'Analyzer value replaces typed value'
          )
        ).status
      ).toBe('IMPORTED');
      expect((await analyteValues(rig.test.id)).WBC).toBe(71.36);
    });

    it('approval rechecks the CURRENT draft: a technician edit after the import forces a second, explicit approval', async () => {
      const rig = await newRig();
      await link(rig);
      expect((await upload(rig, frames[3])).status).toBe('IMPORTED');
      const edited = rewriteFrame(frames[3], (t) =>
        t.replace('71.36', '65.10').replace('20261020092943', '20261020101500')
      );
      const r = await upload(rig, edited);
      expect((await message(r.id)).reasons).toEqual(['CONTENT_CHANGED']); // nobody has touched the draft yet

      // …then a technician edits the draft by hand before the reviewer acts
      const wbc = await prisma.resultTemplateAnalyte.findFirstOrThrow({
        where: { code: 'WBC', version: { definition: { labTenantId: labId } } },
      });
      await resultEntry.saveAnalytes(
        rig.test.id,
        labId,
        [{ templateAnalyteId: wbc.id, numericValue: 70 }],
        undefined,
        userId,
        'Tech'
      );

      // The reviewer approves the (now stale) CONTENT_CHANGED: it is re-checked, NOT applied
      const stale = await review.approve(
        labId,
        r.id,
        { id: userId, name: 'Rev' },
        ['CONTENT_CHANGED'],
        'Looks right'
      );
      expect(stale.status).toBe('NEEDS_REVIEW');
      expect((await message(r.id)).reasons).toEqual(
        expect.arrayContaining([
          'CONTENT_CHANGED',
          'DRAFT_MODIFIED_SINCE_IMPORT',
        ])
      );
      expect((await analyteValues(rig.test.id)).WBC).toBe(70); // the technician's value survived

      // Accepting both, knowingly, replaces it
      await expect(
        review.approve(
          labId,
          r.id,
          { id: userId, name: 'Rev' },
          ['CONTENT_CHANGED'],
          'again'
        )
      ).rejects.toThrow(BadRequestException);
      expect(
        (
          await review.approve(
            labId,
            r.id,
            { id: userId, name: 'Rev' },
            ['CONTENT_CHANGED', 'DRAFT_MODIFIED_SINCE_IMPORT'],
            'Analyzer re-run is authoritative'
          )
        ).status
      ).toBe('IMPORTED');
      expect((await analyteValues(rig.test.id)).WBC).toBe(65.1);
    });

    it('approval rechecks release state: a test submitted for review or released after the change arrived is never written', async () => {
      for (const [label, testStatus, reportTestStatus] of [
        ['in review', 'IN_REVIEW', 'IN_REVIEW'],
        ['released', 'COMPLETED', 'RELEASED'],
      ] as const) {
        const rig = await newRig();
        await link(rig);
        expect((await upload(rig, frames[3])).status).toBe('IMPORTED');
        const edited = rewriteFrame(frames[3], (t) =>
          t
            .replace('71.36', '65.10')
            .replace('20261020092943', '20261020101500')
        );
        const r = await upload(rig, edited);
        expect((await message(r.id)).status).toBe('NEEDS_REVIEW');

        // state changes between the change arriving and the reviewer acting
        await prisma.orderedTest.update({
          where: { id: rig.test.id },
          data: { status: testStatus },
        });
        await prisma.resultReportTest.updateMany({
          where: { orderedTestId: rig.test.id },
          data: { status: reportTestStatus },
        });

        const out = await review.approve(
          labId,
          r.id,
          { id: userId, name: 'Rev' },
          ['CONTENT_CHANGED'],
          `try while ${label}`
        );
        expect(out.status).toBe('NEEDS_REVIEW');
        expect((await message(r.id)).reasons).toContain('TEST_NOT_EDITABLE');
        expect((await analyteValues(rig.test.id)).WBC).toBe(71.36);
      }
    });

    it('a test that cannot take results yet stays in review and imports after it can (reprocess)', async () => {
      const rig = await newRig();
      await link(rig);
      await prisma.orderedTest.update({
        where: { id: rig.test.id },
        data: { status: 'PENDING' },
      });
      const r = await upload(rig, SAMPLE_1111);
      expect(r.status).toBe('NEEDS_REVIEW');
      expect((await message(r.id)).reasons).toContain('TEST_NOT_EDITABLE');
      expect(await analyteValues(rig.test.id)).toEqual({});

      await prisma.orderedTest.update({
        where: { id: rig.test.id },
        data: { status: 'READY' },
      });
      expect((await review.reprocess(labId, r.id)).status).toBe('IMPORTED');
      expect((await analyteValues(rig.test.id)).WBC).toBe(71.36);
    });

    it('never touches a released test: a changed result for it stays in review', async () => {
      const rig = await newRig();
      await link(rig);
      expect((await upload(rig, frames[3])).status).toBe('IMPORTED');
      await prisma.orderedTest.update({
        where: { id: rig.test.id },
        data: { status: 'COMPLETED' },
      });
      await prisma.resultReportTest.updateMany({
        where: { orderedTestId: rig.test.id },
        data: { status: 'RELEASED' },
      });

      const edited = rewriteFrame(frames[3], (t) =>
        t.replace('71.36', '65.10').replace('20261020092943', '20261020101500')
      );
      const r = await upload(rig, edited);
      expect(r.status).toBe('NEEDS_REVIEW');
      const approved = await review.approve(
        labId,
        r.id,
        { id: userId, name: 'Rev' },
        ['CONTENT_CHANGED'],
        'attempt on released'
      );
      expect(approved.status).toBe('NEEDS_REVIEW'); // still blocked: use the amendment workflow
      expect((await message(r.id)).reasons).toContain('TEST_NOT_EDITABLE');
      expect((await analyteValues(rig.test.id)).WBC).toBe(71.36);
    });
  });

  // ── Automatic matching by the order's analyzer number ───────────────────
  // REQ-20YY-NNNNNN ⇄ YYNNNNNN, typed into the analyzer as the sample number.

  describe('automatic matching by analyzer number', () => {
    const RUN_1111 = '20261020092938'; // OBR-7 of the real sample-1111 frame (14:29 UTC)
    /** The real 1111 frame, as if the technician had typed `sampleId` (and optionally a new run time / WBC). */
    const typed = (
      sampleId: string,
      opts: { run?: string; wbc?: string; resend?: boolean } = {}
    ) =>
      rewriteFrame(frames[opts.resend ? 4 : 3], (t) => {
        let out = t.replace('PID|1||1111|', `PID|1||${sampleId}|`);
        if (opts.run) out = out.split(RUN_1111).join(opts.run);
        if (opts.wbc) out = out.replace('71.36', opts.wbc);
        return out;
      });

    /** A real-shaped order: given requisition number, CBC (+ optional other tests), tubes linked through OrderedTestSpecimen. */
    async function numberedOrder(
      forLab: string,
      requisitionNumber: string,
      opts: {
        createdAt?: Date;
        cbcStatus?: string;
        cbcTubes?: string[]; // statuses of the EDTA tubes linked to the CBC
        withoutCbc?: boolean;
        serumTest?: boolean; // an ALT test on its own accepted serum tube
      } = {}
    ) {
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
          requisitionNumber,
          caseId: kase.id,
          tenantId: clinicId,
          labTenantId: forLab,
          orderedItems: [],
          createdAt: opts.createdAt ?? new Date('2026-10-19T00:00:00Z'),
        },
      });
      created.orders.push(order.id);
      const tube = (status: string, i: number, type = 'EDTA_BLOOD') =>
        prisma.specimen.create({
          data: {
            orderId: order.id,
            labTenantId: forLab,
            accessionNumber: `${requisitionNumber}-${type}-${i}`,
            specimenType: type,
            containerType: type === 'SERUM' ? 'SST_TUBE' : 'EDTA_TUBE',
            tubeIndex: i,
            status: status as never,
            receivedAt: new Date(
              (opts.createdAt ?? new Date('2026-10-19T00:00:00Z')).getTime() +
                60_000
            ),
          },
        });
      let cbc: { id: string } | null = null;
      if (!opts.withoutCbc) {
        cbc = await prisma.orderedTest.create({
          data: {
            orderId: order.id,
            catalogItemName: 'Hemograma',
            catalogItemCode: CATALOG,
            status: (opts.cbcStatus ?? 'READY') as never,
          },
        });
        let i = 0;
        for (const st of opts.cbcTubes ?? ['ACCEPTED']) {
          const sp = await tube(st, ++i);
          await prisma.orderedTestSpecimen.create({
            data: { orderedTestId: cbc.id, specimenId: sp.id },
          });
        }
      }
      let alt: { id: string } | null = null;
      if (opts.serumTest || opts.withoutCbc) {
        alt = await prisma.orderedTest.create({
          data: {
            orderId: order.id,
            catalogItemName: 'ALT',
            catalogItemCode: `ALT-${runId}`,
            status: 'READY',
          },
        });
        const sp = await tube('ACCEPTED', 1, 'SERUM');
        await prisma.orderedTestSpecimen.create({
          data: { orderedTestId: alt.id, specimenId: sp.id },
        });
      }
      return { order, cbc, alt };
    }

    const autoRig = async (forLab = labId) => {
      const rig = await newRig(forLab, 'auto');
      await prisma.analyzer.update({
        where: { id: rig.analyzer.id },
        data: { autoMatchOrders: true },
      });
      return rig;
    };
    const values = (testId?: string | null) => analyteValues(testId as string);

    it('1. the correct number imports a draft automatically: no manual link', async () => {
      const rig = await autoRig();
      const { cbc } = await numberedOrder(labId, 'REQ-2026-000101');
      const r = await upload(rig, typed('26000101'));
      expect(r.status).toBe('IMPORTED');
      const m = await message(r.id);
      expect(m).toMatchObject({
        matchedBy: 'ORDER_NUMBER',
        sampleLinkId: null,
      });
      expect((await values(cbc?.id)).WBC).toBe(71.36);
      expect(
        await prisma.instrumentSampleLink.count({
          where: { analyzerId: rig.analyzer.id },
        })
      ).toBe(0);
      const report = await prisma.resultReport.findFirstOrThrow({
        where: { orderId: m.orderId as string },
      });
      expect(report.status).toBe('DRAFT');
      expect(await values(rig.test.id)).toEqual({}); // the rig's own order is untouched
    });

    it('2. an unknown number stays in review, nothing imported', async () => {
      const rig = await autoRig();
      const r = await upload(rig, typed('26000199'));
      expect(r.status).toBe('UNMATCHED');
      expect((await message(r.id)).reasons).toEqual([
        'UNMATCHED',
        'ORDER_NUMBER_NOT_FOUND:REQ-2026-000199',
      ]);
    });

    it("3. a sample ID that is not an analyzer number (the analyzer's own counter) is never read as one", async () => {
      const rig = await autoRig();
      await numberedOrder(labId, 'REQ-2026-001111');
      const r = await upload(rig, frames[3]); // PID-3 = 1111
      expect(r.status).toBe('UNMATCHED');
      expect((await message(r.id)).reasons).toEqual([
        'UNMATCHED',
        'NOT_AN_ORDER_NUMBER',
      ]);
    });

    it('4. the tube is not accepted yet: held, then imported once accepted (reprocess)', async () => {
      const rig = await autoRig();
      const { cbc } = await numberedOrder(labId, 'REQ-2026-000104', {
        cbcStatus: 'PENDING',
        cbcTubes: ['RECEIVED'],
      });
      const r = await upload(rig, typed('26000104'));
      expect(r.status).toBe('NEEDS_REVIEW');
      expect((await message(r.id)).reasons).toEqual([
        `SPECIMEN_NOT_ACCEPTED:${CATALOG}`,
      ]);
      expect(await values(cbc?.id)).toEqual({});

      await prisma.specimen.updateMany({
        where: { orderedTests: { some: { orderedTestId: cbc?.id } } },
        data: { status: 'ACCEPTED' },
      });
      await prisma.orderedTest.update({
        where: { id: cbc?.id },
        data: { status: 'READY' },
      });
      expect((await review.reprocess(labId, r.id)).status).toBe('IMPORTED');
      expect((await values(cbc?.id)).WBC).toBe(71.36);
    });

    it('5. an order with no CBC (chemistry only) is held; its other test is untouched', async () => {
      const rig = await autoRig();
      const { alt } = await numberedOrder(labId, 'REQ-2026-000105', {
        withoutCbc: true,
      });
      const r = await upload(rig, typed('26000105'));
      expect(r.status).toBe('NEEDS_REVIEW');
      expect((await message(r.id)).reasons).toEqual([
        `NO_MATCHING_TEST:${CATALOG}`,
      ]);
      expect(await values(alt?.id)).toEqual({});
    });

    it('6. the same result delivered again (same bytes, or a resend) imports nothing twice', async () => {
      const rig = await autoRig();
      const { cbc } = await numberedOrder(labId, 'REQ-2026-000106');
      const bytes = typed('26000106');
      const first = await upload(rig, bytes);
      expect(first.status).toBe('IMPORTED');
      const again = await upload(rig, bytes);
      expect(again).toMatchObject({ id: first.id, duplicateUpload: true });
      const resend = await upload(rig, typed('26000106', { resend: true }));
      expect(resend.status).toBe('DUPLICATE');
      expect(
        await prisma.timelineEvent.count({
          where: {
            orderId: (await message(first.id)).orderId as string,
            eventType: 'INSTRUMENT_RESULTS_IMPORTED',
          },
        })
      ).toBe(1);
      expect((await values(cbc?.id)).WBC).toBe(71.36);
    });

    it('7. a rerun with different values is held as ANALYZER_RERUN with a diff, and replaces the draft only when approved', async () => {
      const rig = await autoRig();
      const { cbc } = await numberedOrder(labId, 'REQ-2026-000107');
      expect((await upload(rig, typed('26000107'))).status).toBe('IMPORTED');
      const rerun = await upload(
        rig,
        typed('26000107', { run: '20261020101500', wbc: '65.10' })
      );
      expect(rerun.status).toBe('NEEDS_REVIEW');
      const m = await message(rerun.id);
      expect(m.reasons).toEqual(['ANALYZER_RERUN']);
      expect(
        (m.diff as { changed: Array<{ code: string }> }).changed.map(
          (c) => c.code
        )
      ).toContain('WBC');
      expect((await values(cbc?.id)).WBC).toBe(71.36); // untouched until approved

      const approved = await review.approve(
        labId,
        rerun.id,
        { id: userId, name: 'Rev' },
        ['ANALYZER_RERUN'],
        'rerun accepted'
      );
      expect(approved.status).toBe('IMPORTED');
      expect((await values(cbc?.id)).WBC).toBe(65.1);
    });

    it('8. a released report is never overwritten: a rerun after release stays in review, even when approved', async () => {
      const rig = await autoRig();
      const { cbc } = await numberedOrder(labId, 'REQ-2026-000108');
      expect((await upload(rig, typed('26000108'))).status).toBe('IMPORTED');
      await prisma.orderedTest.update({
        where: { id: cbc?.id },
        data: { status: 'COMPLETED' },
      });
      await prisma.resultReportTest.updateMany({
        where: { orderedTestId: cbc?.id },
        data: { status: 'RELEASED' },
      });
      const rerun = await upload(
        rig,
        typed('26000108', { run: '20261020101500', wbc: '65.10' })
      );
      expect(rerun.status).toBe('NEEDS_REVIEW');
      const approved = await review.approve(
        labId,
        rerun.id,
        { id: userId, name: 'Rev' },
        ['ANALYZER_RERUN'],
        'attempt on released'
      );
      expect(approved.status).toBe('NEEDS_REVIEW');
      expect((await message(rerun.id)).reasons).toContain('TEST_NOT_EDITABLE');
      expect((await values(cbc?.id)).WBC).toBe(71.36);
    });

    it('9. the same sequence in different years goes to the right year', async () => {
      const rig = await autoRig();
      const y26 = await numberedOrder(labId, 'REQ-2026-000109');
      const y27 = await numberedOrder(labId, 'REQ-2027-000109', {
        createdAt: new Date('2027-01-10T12:00:00Z'),
      });
      expect(
        (await upload(rig, typed('27000109', { run: '20270115100000' }))).status
      ).toBe('IMPORTED');
      expect((await values(y27.cbc?.id)).WBC).toBe(71.36);
      expect(await values(y26.cbc?.id)).toEqual({});
      expect((await upload(rig, typed('26000109'))).status).toBe('IMPORTED');
      expect((await values(y26.cbc?.id)).WBC).toBe(71.36);
    });

    it("10. the same number in two labs: each lab's analyzer only ever reaches its own order", async () => {
      const rigA = await autoRig(labId);
      const a = await numberedOrder(labId, 'REQ-2026-000110');
      const b = await numberedOrder(labBId, 'REQ-2026-000110');
      expect((await upload(rigA, typed('26000110'))).status).toBe('IMPORTED');
      expect((await values(a.cbc?.id)).WBC).toBe(71.36);
      expect(await values(b.cbc?.id)).toEqual({});

      // a number that exists only in lab B is unknown to lab A
      await numberedOrder(labBId, 'REQ-2026-000210');
      const r = await upload(rigA, typed('26000210'));
      expect(r.status).toBe('UNMATCHED');
      expect((await message(r.id)).reasons).toContain(
        'ORDER_NUMBER_NOT_FOUND:REQ-2026-000210'
      );
    });

    it('11. several tubes: CBC values go to the CBC test on its EDTA tube; two accepted EDTA tubes are never guessed', async () => {
      const rig = await autoRig();
      const { cbc, alt } = await numberedOrder(labId, 'REQ-2026-000111', {
        serumTest: true,
      });
      const r = await upload(rig, typed('26000111'));
      expect(r.status).toBe('IMPORTED');
      expect((await values(cbc?.id)).WBC).toBe(71.36);
      expect(await values(alt?.id)).toEqual({});
      const tests = (
        (await message(r.id)).parsed as {
          import: {
            tests: Array<{ orderedTestId: string; accessionNumber: string }>;
          };
        }
      ).import.tests;
      expect(tests).toEqual([
        expect.objectContaining({
          orderedTestId: cbc?.id,
          accessionNumber: 'REQ-2026-000111-EDTA_BLOOD-1',
        }),
      ]);

      const two = await numberedOrder(labId, 'REQ-2026-000211', {
        cbcTubes: ['ACCEPTED', 'ACCEPTED'],
      });
      const r2 = await upload(rig, typed('26000211'));
      expect(r2.status).toBe('NEEDS_REVIEW');
      expect((await message(r2.id)).reasons).toEqual([
        `MULTIPLE_ACCEPTED_SPECIMENS:${CATALOG}`,
      ]);
      expect(await values(two.cbc?.id)).toEqual({});
    });

    it("12. two analyzers sending the same number never overwrite each other's results", async () => {
      const hema = await autoRig();
      const { cbc } = await numberedOrder(labId, 'REQ-2026-000112');
      expect((await upload(hema, typed('26000112'))).status).toBe('IMPORTED');

      // a chemistry analyzer: its mappings name only its own test, so it cannot reach the CBC
      const chem = await prisma.analyzer.create({
        data: {
          labTenantId: labId,
          name: `Chem ${randomUUID().slice(0, 6)}`,
          department: 'HEMATOLOGY',
          autoMatchOrders: true,
        },
      });
      await prisma.instrumentParameterMapping.create({
        data: {
          labTenantId: labId,
          analyzerId: chem.id,
          parameterCode: 'WBC',
          analyzerUnit: '10^9/L',
          catalogItemCode: `CHEM-${runId}`,
          analyteCode: 'WBC',
        },
      });
      const chemCred = await credentials.create(labId, chem.id, 'chem', userId);
      const chemRig = {
        ...hema,
        analyzer: chem,
        connector: (await credentials.authenticate(chemCred.token))!,
      };
      const c = await upload(chemRig, typed('26000112', { wbc: '99.99' }));
      expect(c.status).toBe('NEEDS_REVIEW');
      expect((await message(c.id)).reasons).toEqual([
        `NO_MATCHING_TEST:CHEM-${runId}`,
      ]);

      // a second hematology analyzer mapping the same test is held, never a silent overwrite
      const hema2 = await autoRig();
      const h2 = await upload(hema2, typed('26000112', { wbc: '99.99' }));
      expect(h2.status).toBe('NEEDS_REVIEW');
      expect((await message(h2.id)).reasons).toEqual(['ANALYZER_RERUN']);
      expect((await values(cbc?.id)).WBC).toBe(71.36);
    });

    it('13. a legacy requisition format has no number, but a manual link still imports', async () => {
      const rig = await autoRig(); // rig.order is "IT-xxxxxxxx": no analyzer number
      await link(rig);
      const r = await upload(rig, frames[3]);
      expect(r.status).toBe('IMPORTED');
      expect((await message(r.id)).matchedBy).toBe('SAMPLE_LINK');
      expect((await values(rig.test.id)).WBC).toBe(71.36);
    });

    it('14. a manual link and the number naming different orders: held; approving imports into the LINKED order', async () => {
      const rig = await autoRig();
      const numbered = await numberedOrder(labId, 'REQ-2026-000114');
      await link(rig, '26000114'); // a person linked it to the rig's (other) order
      const r = await upload(rig, typed('26000114'));
      expect(r.status).toBe('NEEDS_REVIEW');
      expect((await message(r.id)).reasons).toEqual([
        'ORDER_NUMBER_LINK_CONFLICT:REQ-2026-000114',
      ]);
      expect(await values(numbered.cbc?.id)).toEqual({});

      const approved = await review.approve(
        labId,
        r.id,
        { id: userId, name: 'Rev' },
        ['ORDER_NUMBER_LINK_CONFLICT'],
        'tech typed the wrong number'
      );
      expect(approved.status).toBe('IMPORTED');
      expect((await values(rig.test.id)).WBC).toBe(71.36);
      expect(await values(numbered.cbc?.id)).toEqual({});
    });

    it('15. with automatic matching off, the number is ignored and the manual workflow works as before', async () => {
      const rig = await newRig(); // autoMatchOrders defaults to false
      const { order, cbc } = await numberedOrder(labId, 'REQ-2026-000115');
      const r = await upload(rig, typed('26000115'));
      expect(r.status).toBe('UNMATCHED');
      expect((await message(r.id)).reasons).toEqual(['UNMATCHED']);
      expect(
        (await review.resolveSample(labId, r.id, order.id, userId)).status
      ).toBe('IMPORTED');
      expect((await values(cbc?.id)).WBC).toBe(71.36);
    });

    it('the order page status reflects what arrived', async () => {
      const rig = await autoRig();
      const { order } = await numberedOrder(labId, 'REQ-2026-000116');
      let status = await review.orderStatus(labId, order.id);
      expect(status.analyzerNumber).toBe('26000116');
      expect(status.analyzers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            analyzerId: rig.analyzer.id,
            state: 'WAITING',
          }),
        ])
      );
      await upload(rig, typed('26000116'));
      status = await review.orderStatus(labId, order.id);
      expect(status.analyzers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            analyzerId: rig.analyzer.id,
            state: 'IMPORTED',
          }),
        ])
      );
      await expect(review.orderStatus(labBId, order.id)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });
});
