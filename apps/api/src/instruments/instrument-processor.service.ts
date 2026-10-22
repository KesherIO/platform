import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResultEntryService } from '../lab/result-entry.service';
import { diffSummaries, type MessageDiff, type StoredSummary } from './hl7-oru';
import { planMapping, type PlannedValue } from './instrument-mapping.util';

/**
 * Reasons a person may knowingly accept. Everything else (no sample link, unit
 * mismatch, missing test…) has to be FIXED — link the sample, add the mapping,
 * accept the specimen — and the message reprocessed; approving can't skip it.
 */
export const APPROVABLE_REASONS = [
  'CONTENT_CHANGED',
  'EXPIRED_REAGENT',
  'EXISTING_MANUAL_VALUES',
  'DRAFT_MODIFIED_SINCE_IMPORT',
] as const;

export interface ProcessOptions {
  /** reason codes a reviewer approved (filtered to APPROVABLE_REASONS) */
  approved?: string[];
  actor?: { id: string; name: string };
}

type Planned = PlannedValue;

const reasonCode = (reason: string) => reason.split(':')[0];
@Injectable()
export class InstrumentProcessorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resultEntry: ResultEntryService
  ) {}

  /** Runs one complete message through dedupe → match → map → (maybe) draft import. Returns its final status. */
  async process(messageId: string, opts: ProcessOptions = {}): Promise<string> {
    const msg = await this.prisma.instrumentMessage.findUniqueOrThrow({
      where: { id: messageId },
      include: { analyzer: { select: { name: true } } },
    });
    // Interrupted transfers are never processed, whatever calls this.
    if (!msg.isComplete || msg.status === 'INCOMPLETE') return 'INCOMPLETE';
    if (!msg.parsed || !msg.contentHash || !msg.sampleId) {
      return this.finish(msg.id, 'FAILED', ['UNPARSEABLE_MESSAGE']);
    }
    const summary = msg.parsed as unknown as StoredSummary;
    const approved = new Set(
      (opts.approved ?? []).filter((r) =>
        (APPROVABLE_REASONS as readonly string[]).includes(r)
      )
    );
    const reasons: string[] = [];
    let diff: MessageDiff | null = null;
    let previousMessageId: string | null = null;

    // ── 1. Same run seen before? ───────────────────────────────────────────
    const run: Prisma.InstrumentMessageWhereInput = msg.observationTime
      ? { observationTime: msg.observationTime }
      : { controlId: msg.controlId };
    const priors = await this.prisma.instrumentMessage.findMany({
      where: {
        labTenantId: msg.labTenantId,
        analyzerId: msg.analyzerId,
        sampleId: msg.sampleId,
        isComplete: true,
        id: { not: msg.id },
        status: { notIn: ['INCOMPLETE', 'FAILED'] },
        ...run,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        contentHash: true,
        parsed: true,
        orderedTestId: true,
        importedAt: true,
      },
    });
    const same = priors.find(
      (p) => p.contentHash === msg.contentHash && p.status !== 'DUPLICATE'
    );
    if (same) {
      // A resend (new MSH-7, same content). Nothing new to import or review.
      return this.finish(msg.id, 'DUPLICATE', [], {
        previousMessageId: same.id,
      });
    }
    const lastImported = priors.find((p) => p.status === 'IMPORTED');
    if (lastImported) {
      reasons.push('CONTENT_CHANGED');
      previousMessageId = lastImported.id;
      diff = diffSummaries(
        lastImported.parsed as unknown as StoredSummary,
        summary
      );
    }

    // ── 2. OBX-13 flags — expired reagent is its own review reason ────────────
    if (msg.hasExpiredReagent) reasons.push('EXPIRED_REAGENT');

    // ── 3. Explicit sample link (never "sample 168 = order 168") ──────────────
    const at = msg.observationTime ?? msg.receivedAtConnector;
    const links = await this.prisma.instrumentSampleLink.findMany({
      where: {
        labTenantId: msg.labTenantId,
        analyzerId: msg.analyzerId,
        sampleId: msg.sampleId,
        endedAt: null,
        validFrom: { lte: at },
        validUntil: { gte: at },
      },
      select: { id: true, orderId: true },
    });
    const orderIds = [...new Set(links.map((l) => l.orderId))];
    const common = { diff, previousMessageId };
    if (orderIds.length === 0)
      return this.finish(
        msg.id,
        'UNMATCHED',
        ['UNMATCHED', ...reasons],
        common
      );
    if (orderIds.length > 1)
      return this.finish(
        msg.id,
        'AMBIGUOUS',
        ['AMBIGUOUS_SAMPLE', ...reasons],
        common
      );
    const link = links[0];
    const matched = { ...common, orderId: link.orderId, sampleLinkId: link.id };

    // ── 4. The order must be this lab's and still open ───────────────────────
    const order = await this.prisma.order.findFirst({
      where: { id: link.orderId, labTenantId: msg.labTenantId },
      select: {
        id: true,
        status: true,
        orderedTests: {
          select: {
            id: true,
            catalogItemCode: true,
            catalogItemName: true,
            status: true,
          },
        },
      },
    });
    if (!order || order.status === 'CANCELLED') {
      return this.finish(
        msg.id,
        'NEEDS_REVIEW',
        ['ORDER_NOT_AVAILABLE', ...reasons],
        matched
      );
    }

    // ── 5. Explicit parameter mapping with unit validation ───────────────────
    const mappings = await this.prisma.instrumentParameterMapping.findMany({
      where: { labTenantId: msg.labTenantId, analyzerId: msg.analyzerId },
    });
    const { plan, ignored, unitMismatches } = planMapping(
      summary.parameters,
      mappings
    );
    for (const u of unitMismatches)
      reasons.push(`UNIT_MISMATCH:${u.code}:${u.unit || '(none)'}`);
    if (plan.length === 0 && unitMismatches.length === 0)
      reasons.push('NO_MAPPED_PARAMETERS');

    // ── 6. The ordered test(s) these values belong to ────────────────────────
    const byCatalog = new Map<string, Planned[]>();
    for (const item of plan)
      byCatalog.set(item.catalogItemCode, [
        ...(byCatalog.get(item.catalogItemCode) ?? []),
        item,
      ]);
    const targets: Array<{
      test: (typeof order.orderedTests)[number];
      items: Planned[];
    }> = [];
    for (const [code, items] of byCatalog) {
      const test = order.orderedTests.find(
        (t) => t.catalogItemCode === code && t.status !== 'CANCELLED'
      );
      if (!test) reasons.push(`NO_MATCHING_TEST:${code}`);
      else targets.push({ test, items });
    }

    // ── 7. Template + existing-values check (read only) ──────────────────────
    const sessions = new Map<string, Map<string, string>>();
    const writeItems = new Map<string, Planned[]>();
    const formulaComputed: Array<{
      analyteCode: string;
      analyzerCode: string;
      analyzerValue: number;
    }> = [];
    for (const { test, items } of targets) {
      let analytes: Map<
        string,
        {
          id: string;
          hasValue: boolean;
          numeric: number | null;
          formula: string | null;
        }
      >;
      try {
        const session = await this.resultEntry.getResultSession(
          test.id,
          msg.labTenantId
        );
        analytes = new Map(
          session.sections.flatMap((s) =>
            (
              s.analytes as Array<{
                id: string;
                code: string;
                isHeader: boolean;
                formula?: string | null;
                numericValue: number | null;
                textValue: string | null;
                booleanValue: boolean | null;
                selectValue: string | null;
              }>
            )
              .filter((a) => !a.isHeader)
              .map(
                (a) =>
                  [
                    a.code,
                    {
                      id: a.id,
                      hasValue:
                        a.numericValue != null ||
                        a.textValue != null ||
                        a.booleanValue != null ||
                        a.selectValue != null,
                      numeric: a.numericValue,
                      formula: a.formula ?? null,
                    },
                  ] as const
              )
          )
        );
      } catch (err) {
        reasons.push('TEST_NOT_EDITABLE');
        return this.finish(msg.id, 'NEEDS_REVIEW', reasons, {
          ...matched,
          processingError: this.errorText(err),
        });
      }
      const ids = new Map<string, string>();
      let manualValues = false;
      for (const item of items) {
        const a = analytes.get(item.analyteCode);
        if (!a) reasons.push(`ANALYTE_NOT_IN_TEMPLATE:${item.analyteCode}`);
        else {
          ids.set(item.analyteCode, a.id);
          if (a.hasValue) manualValues = true;
        }
      }
      // Never silently overwrite what a person typed. Two cases, both re-read from the LIVE draft now
      // (so an approval made on an old screen is re-checked against today's state):
      //  - this analyzer run never wrote to this test: values already there were typed by hand;
      //  - it did: the draft must still hold exactly what that import wrote, else someone edited it since.
      const lastImport = priors
        .filter((p) => p.orderedTestId === test.id && p.status === 'IMPORTED')
        .sort(
          (a, b) =>
            (b.importedAt?.getTime() ?? 0) - (a.importedAt?.getTime() ?? 0)
        )[0];
      if (!lastImport) {
        if (manualValues) reasons.push('EXISTING_MANUAL_VALUES');
      } else {
        const wrote = new Map(
          (
            (lastImport.parsed as { import?: { plan?: Planned[] } } | null)
              ?.import?.plan ?? []
          )
            .filter((p) => p.catalogItemCode === (test.catalogItemCode ?? ''))
            .map((p) => [p.analyteCode, p.value] as const)
        );
        const edited = [...wrote].some(([code, value]) => {
          const now = analytes.get(code)?.numeric;
          return now == null || Math.abs(now - value) > 1e-9;
        });
        if (edited) reasons.push('DRAFT_MODIFIED_SINCE_IMPORT');
      }
      // The template computes formula fields itself (and overwrites any value saved for them), so the
      // analyzer's figure for those is not used. Say so instead of counting them as imported.
      const derived = items.filter((i) => analytes.get(i.analyteCode)?.formula);
      writeItems.set(
        test.id,
        items.filter(
          (i) => ids.has(i.analyteCode) && !analytes.get(i.analyteCode)?.formula
        )
      );
      for (const d of derived)
        formulaComputed.push({
          analyteCode: d.analyteCode,
          analyzerCode: d.analyzerCode,
          analyzerValue: d.value,
        });
      sessions.set(test.id, ids);
    }
    const writePlan = [...writeItems.values()].flat();
    if (
      targets.length > 0 &&
      writePlan.length === 0 &&
      !reasons.some((r) => reasonCode(r) === 'ANALYTE_NOT_IN_TEMPLATE')
    ) {
      reasons.push('NO_MAPPED_PARAMETERS'); // everything mapped is computed by the template
    }
    const importInfo = { plan: writePlan, formulaComputed, ignored };

    const unresolved = reasons.filter((r) => !approved.has(reasonCode(r)));
    if (unresolved.length > 0) {
      return this.finish(msg.id, 'NEEDS_REVIEW', reasons, {
        ...matched,
        importInfo,
      });
    }

    // ── 8. Draft import through the existing result-entry workflow ───────────
    const actor = opts.actor ?? {
      id: `connector:${msg.credentialId}`,
      name: `${msg.analyzer.name} (connector)`,
    };
    let imported = 0;
    for (const { test } of targets) {
      const ids = sessions.get(test.id) as Map<string, string>;
      const latestPerAnalyte = new Map(
        (writeItems.get(test.id) ?? []).map((i) => [i.analyteCode, i])
      );
      if (latestPerAnalyte.size === 0) continue;
      try {
        await this.resultEntry.saveAnalytes(
          test.id,
          msg.labTenantId,
          [...latestPerAnalyte.values()].map((i) => ({
            templateAnalyteId: ids.get(i.analyteCode) as string,
            numericValue: i.value,
          })),
          undefined,
          actor.id,
          actor.name
        );
      } catch (err) {
        // e.g. the test went to review/released, or isn't accepted yet: nothing was written for it.
        return this.finish(
          msg.id,
          'NEEDS_REVIEW',
          [...reasons, 'TEST_NOT_EDITABLE'],
          {
            ...matched,
            processingError:
              (imported > 0
                ? `Partially imported (${imported} values). `
                : '') + this.errorText(err),
            importInfo,
          }
        );
      }
      imported += latestPerAnalyte.size;
      await this.prisma.orderedTest.update({
        where: { id: test.id },
        data: {
          entryMethod: 'INSTRUMENT',
          resultEntrySource: 'DIRECT_INTEGRATION',
          processingMethod: 'ANALYZER',
          analyzerId: msg.analyzerId,
        },
      });
      await this.prisma.timelineEvent.create({
        data: {
          orderId: order.id,
          eventType: 'INSTRUMENT_RESULTS_IMPORTED',
          actorId: actor.id,
          actorName: actor.name,
          description: `${test.catalogItemName}: ${latestPerAnalyte.size} analyzer values saved as draft (${msg.analyzer.name}, sample ${msg.sampleId})`,
          metadata: {
            orderedTestId: test.id,
            messageId: msg.id,
            analyzerId: msg.analyzerId,
            approvedReasons: [...approved],
          },
        },
      });
    }

    const status = await this.finish(msg.id, 'IMPORTED', [], {
      ...matched,
      orderedTestId: targets[0]?.test.id ?? null,
      importedCount: imported,
      importInfo,
      reviewer: opts.actor && approved.size > 0 ? opts.actor.id : undefined,
    });
    // Anything still open for this same run is settled by this import.
    await this.prisma.instrumentMessage.updateMany({
      where: {
        labTenantId: msg.labTenantId,
        analyzerId: msg.analyzerId,
        sampleId: msg.sampleId,
        id: { not: msg.id },
        resolvedAt: null,
        status: { in: ['UNMATCHED', 'AMBIGUOUS', 'NEEDS_REVIEW'] },
        ...run,
      },
      data: {
        resolvedAt: new Date(),
        reviewNote: `Settled by message ${msg.id}.`,
      },
    });
    return status;
  }

  private errorText(err: unknown): string {
    if (err && typeof err === 'object' && 'response' in err) {
      const r = (err as { response?: { message?: string } }).response;
      if (r?.message) return String(r.message).slice(0, 500);
    }
    return (err instanceof Error ? err.message : String(err)).slice(0, 500);
  }

  private async finish(
    id: string,
    status:
      | 'FAILED'
      | 'DUPLICATE'
      | 'UNMATCHED'
      | 'AMBIGUOUS'
      | 'NEEDS_REVIEW'
      | 'IMPORTED',
    reasons: string[],
    extra: {
      diff?: MessageDiff | null;
      previousMessageId?: string | null;
      orderId?: string;
      orderedTestId?: string | null;
      sampleLinkId?: string;
      importedCount?: number;
      processingError?: string;
      importInfo?: unknown;
      reviewer?: string;
    } = {}
  ): Promise<string> {
    const existing = extra.importInfo
      ? await this.prisma.instrumentMessage.findUnique({
          where: { id },
          select: { parsed: true },
        })
      : null;
    const now = new Date();
    await this.prisma.instrumentMessage.update({
      where: { id },
      data: {
        status,
        reasons,
        processedAt: now,
        processingError: extra.processingError ?? null,
        diff: extra.diff
          ? (extra.diff as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        previousMessageId: extra.previousMessageId ?? null,
        ...(extra.orderId && { orderId: extra.orderId }),
        ...(extra.sampleLinkId && { sampleLinkId: extra.sampleLinkId }),
        ...(extra.orderedTestId !== undefined && {
          orderedTestId: extra.orderedTestId,
        }),
        ...(status === 'IMPORTED' && {
          importedAt: now,
          importedCount: extra.importedCount ?? 0,
        }),
        ...(extra.reviewer && {
          reviewedById: extra.reviewer,
          reviewedAt: now,
        }),
        ...(extra.importInfo !== undefined
          ? {
              parsed: {
                ...((existing?.parsed as Record<string, unknown> | null) ?? {}),
                import: extra.importInfo,
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    return status;
  }
}
