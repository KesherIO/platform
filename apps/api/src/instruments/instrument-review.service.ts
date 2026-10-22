import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { gunzipSync } from 'node:zlib';
import { PrismaService } from '../prisma/prisma.service';
import {
  APPROVABLE_REASONS,
  InstrumentProcessorService,
} from './instrument-processor.service';
import type {
  CreateSampleLinkDto,
  UpsertMappingDto,
} from './dto/instruments.dto';
import type { StoredSummary } from './hl7-oru';
import { planMapping } from './instrument-mapping.util';

const HOUR = 3_600_000;
/** Statuses a person has to act on. INCOMPLETE is listed separately: it can only be re-sent, never approved. */
const REVIEW_STATUSES = [
  'UNMATCHED',
  'AMBIGUOUS',
  'NEEDS_REVIEW',
  'FAILED',
] as const;
const REPROCESSABLE = [...REVIEW_STATUSES] as string[];

export type QueueView = 'review' | 'incomplete' | 'attention' | 'all';

@Injectable()
export class InstrumentReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: InstrumentProcessorService
  ) {}

  // ── Queue ────────────────────────────────────────────────────────────────

  async summary(labTenantId: string) {
    const [review, incomplete] = await Promise.all([
      this.prisma.instrumentMessage.count({
        where: {
          labTenantId,
          resolvedAt: null,
          status: { in: [...REVIEW_STATUSES] },
        },
      }),
      this.prisma.instrumentMessage.count({
        where: { labTenantId, resolvedAt: null, status: 'INCOMPLETE' },
      }),
    ]);
    return { needsReview: review, incomplete };
  }

  async list(labTenantId: string, view: QueueView, take = 50, cursor?: string) {
    const where: Prisma.InstrumentMessageWhereInput = { labTenantId };
    if (view === 'review')
      Object.assign(where, {
        resolvedAt: null,
        status: { in: [...REVIEW_STATUSES] },
      });
    else if (view === 'incomplete')
      Object.assign(where, { resolvedAt: null, status: 'INCOMPLETE' });
    else if (view === 'attention') {
      Object.assign(where, {
        resolvedAt: null,
        status: { in: [...REVIEW_STATUSES, 'INCOMPLETE'] },
      });
    }
    const rows = await this.prisma.instrumentMessage.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(take, 1), 200) + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        status: true,
        reasons: true,
        isComplete: true,
        incompleteReason: true,
        sampleId: true,
        controlId: true,
        observationTime: true,
        receivedAtConnector: true,
        createdAt: true,
        hasAnalyzerEdits: true,
        hasExpiredReagent: true,
        importedCount: true,
        resolvedAt: true,
        orderId: true,
        analyzer: { select: { id: true, name: true } },
        order: { select: { requisitionNumber: true } },
      },
    });
    const page = Math.min(Math.max(take, 1), 200);
    return {
      items: rows.slice(0, page),
      nextCursor: rows.length > page ? rows[page - 1].id : null,
    };
  }

  async get(labTenantId: string, id: string) {
    const msg = await this.prisma.instrumentMessage.findFirst({
      where: { id, labTenantId },
      include: {
        analyzer: { select: { id: true, name: true } },
        order: { select: { id: true, requisitionNumber: true, status: true } },
      },
    });
    if (!msg) throw new NotFoundException('Message not found.');
    const history = msg.sampleId
      ? await this.prisma.instrumentMessage.findMany({
          where: {
            labTenantId,
            analyzerId: msg.analyzerId,
            sampleId: msg.sampleId,
            id: { not: id },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            status: true,
            controlId: true,
            messageTime: true,
            createdAt: true,
            isComplete: true,
          },
        })
      : [];
    return {
      ...msg,
      history,
      approvableReasons: APPROVABLE_REASONS,
      mappingPreview: await this.mappingPreview(msg),
    };
  }

  /**
   * What the importer WOULD do with this message under the lab's CURRENT mappings — available for any
   * complete message (unmatched ones included), so partial mapping is visible before anything is imported:
   * which values map to which result fields, which parameters are not mapped, which are in an unmapped unit.
   */
  private async mappingPreview(msg: {
    labTenantId: string;
    analyzerId: string;
    isComplete: boolean;
    parsed: unknown;
  }) {
    const summary = msg.parsed as StoredSummary | null;
    if (!msg.isComplete || !summary) return null;
    const mappings = await this.prisma.instrumentParameterMapping.findMany({
      where: { labTenantId: msg.labTenantId, analyzerId: msg.analyzerId },
    });
    const { plan, ignored, unitMismatches } = planMapping(
      summary.parameters,
      mappings
    );
    const numeric = summary.parameters.filter(
      (p) => p.valueType === 'NM'
    ).length;
    return {
      numericParameters: numeric,
      importable: plan,
      unitMismatches,
      notMapped: ignored
        .filter((i) => i.reason === 'NO_MAPPING')
        .map((i) => i.code),
      notImported: ignored,
      isPartial: plan.length < numeric,
    };
  }

  /** The exact bytes the analyzer sent, for troubleshooting. */
  async raw(labTenantId: string, id: string) {
    const msg = await this.prisma.instrumentMessage.findFirst({
      where: { id, labTenantId },
      select: {
        sha256: true,
        sampleId: true,
        controlId: true,
        payload: { select: { bytes: true, compression: true } },
      },
    });
    if (!msg?.payload) throw new NotFoundException('Message not found.');
    const bytes =
      msg.payload.compression === 'gzip'
        ? gunzipSync(msg.payload.bytes)
        : Buffer.from(msg.payload.bytes);
    return {
      bytes,
      fileName: `vh30-${msg.sampleId ?? 'unknown'}-${
        msg.controlId ?? 'x'
      }-${msg.sha256.slice(0, 8)}.frame`,
    };
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Staff say "this analyzer sample is that order": creates an explicit link and reprocesses. */
  async resolveSample(
    labTenantId: string,
    id: string,
    orderId: string,
    userId: string
  ) {
    const msg = await this.prisma.instrumentMessage.findFirst({
      where: { id, labTenantId },
      select: {
        id: true,
        status: true,
        analyzerId: true,
        sampleId: true,
        isComplete: true,
        observationTime: true,
        receivedAtConnector: true,
      },
    });
    if (!msg) throw new NotFoundException('Message not found.');
    if (!msg.isComplete)
      throw new BadRequestException(
        'An incomplete transfer cannot be linked or imported. Resend it from the analyzer.'
      );
    if (!msg.sampleId)
      throw new BadRequestException('This message has no sample ID.');
    if (!REPROCESSABLE.includes(msg.status))
      throw new ConflictException(
        `Message is ${msg.status}; nothing to resolve.`
      );

    const at = msg.observationTime ?? msg.receivedAtConnector;
    await this.createLinkChecked(labTenantId, {
      analyzerId: msg.analyzerId,
      sampleId: msg.sampleId,
      orderId,
      validFrom: new Date(at.getTime() - HOUR),
      validUntil: new Date(at.getTime() + 24 * HOUR),
      createdById: userId,
      createdVia: 'REVIEW',
    });
    const status = await this.processor.process(id);
    return { id, status };
  }

  async approve(
    labTenantId: string,
    id: string,
    actor: { id: string; name: string },
    reasons: string[],
    note: string
  ) {
    const msg = await this.findOpen(labTenantId, id, ['NEEDS_REVIEW']);
    const offered = reasons.filter((r) =>
      (APPROVABLE_REASONS as readonly string[]).includes(r)
    );
    const open = msg.reasons
      .map((r) => r.split(':')[0])
      .filter((r) => (APPROVABLE_REASONS as readonly string[]).includes(r));
    if (open.length === 0) {
      throw new BadRequestException(
        'Nothing in this message can be approved. Link the sample, add the parameter mapping or fix the test, then reprocess it.'
      );
    }
    if (open.some((r) => !offered.includes(r))) {
      throw new BadRequestException(
        `Approve every approvable reason to import: ${open.join(', ')}.`
      );
    }
    await this.prisma.instrumentMessage.update({
      where: { id },
      data: {
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });
    const status = await this.processor.process(id, {
      approved: offered,
      actor,
    });
    return { id, status };
  }

  async reprocess(labTenantId: string, id: string) {
    await this.findOpen(labTenantId, id, REPROCESSABLE);
    return { id, status: await this.processor.process(id) };
  }

  async dismiss(labTenantId: string, id: string, userId: string, note: string) {
    const msg = await this.findOpen(labTenantId, id, [
      ...REPROCESSABLE,
      'INCOMPLETE',
    ]);
    const now = new Date();
    await this.prisma.instrumentMessage.update({
      where: { id },
      data: {
        // An interrupted transfer stays visibly INCOMPLETE forever; it is only acknowledged.
        ...(msg.status !== 'INCOMPLETE' && { status: 'DISMISSED' }),
        resolvedAt: now,
        reviewedById: userId,
        reviewedAt: now,
        reviewNote: note,
      },
    });
    return {
      id,
      status: msg.status === 'INCOMPLETE' ? 'INCOMPLETE' : 'DISMISSED',
    };
  }

  private async findOpen(labTenantId: string, id: string, statuses: string[]) {
    const msg = await this.prisma.instrumentMessage.findFirst({
      where: { id, labTenantId },
      select: { id: true, status: true, reasons: true, resolvedAt: true },
    });
    if (!msg) throw new NotFoundException('Message not found.');
    if (!statuses.includes(msg.status))
      throw new ConflictException(
        `Message is ${msg.status}; this action does not apply.`
      );
    return msg;
  }

  // ── Sample links ─────────────────────────────────────────────────────────

  listLinks(
    labTenantId: string,
    filter: { analyzerId?: string; orderId?: string }
  ) {
    return this.prisma.instrumentSampleLink.findMany({
      where: { labTenantId, ...filter },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        analyzer: { select: { name: true } },
        order: { select: { requisitionNumber: true } },
      },
    });
  }

  createLink(labTenantId: string, dto: CreateSampleLinkDto, userId: string) {
    const validFrom = dto.validFrom ?? new Date();
    const validUntil =
      dto.validUntil ?? new Date(validFrom.getTime() + 24 * HOUR);
    return this.createLinkChecked(labTenantId, {
      analyzerId: dto.analyzerId,
      sampleId: dto.sampleId.trim(),
      orderId: dto.orderId,
      validFrom,
      validUntil,
      createdById: userId,
      createdVia: 'MANUAL',
    });
  }

  async endLink(labTenantId: string, id: string) {
    const link = await this.prisma.instrumentSampleLink.findFirst({
      where: { id, labTenantId },
      select: { id: true },
    });
    if (!link) throw new NotFoundException('Link not found.');
    return this.prisma.instrumentSampleLink.update({
      where: { id },
      data: { endedAt: new Date() },
    });
  }

  /**
   * Both the analyzer and the order must belong to THIS lab, and no other
   * order may hold the same analyzer sample ID in an overlapping window —
   * the analyzer reuses IDs, so overlap would be a guess.
   */
  private async createLinkChecked(
    labTenantId: string,
    d: {
      analyzerId: string;
      sampleId: string;
      orderId: string;
      validFrom: Date;
      validUntil: Date;
      createdById: string;
      createdVia: string;
    }
  ) {
    if (!(d.validUntil > d.validFrom))
      throw new BadRequestException('validUntil must be after validFrom.');
    const [analyzer, order] = await Promise.all([
      this.prisma.analyzer.findFirst({
        where: { id: d.analyzerId, labTenantId },
        select: { id: true },
      }),
      this.prisma.order.findFirst({
        where: { id: d.orderId, labTenantId },
        select: { id: true, status: true },
      }),
    ]);
    if (!analyzer)
      throw new NotFoundException('Analyzer not found in this laboratory.');
    if (!order)
      throw new NotFoundException('Order not found in this laboratory.');
    if (order.status === 'CANCELLED')
      throw new BadRequestException('The order is cancelled.');

    const overlapping = await this.prisma.instrumentSampleLink.findMany({
      where: {
        labTenantId,
        analyzerId: d.analyzerId,
        sampleId: d.sampleId,
        endedAt: null,
        validFrom: { lt: d.validUntil },
        validUntil: { gt: d.validFrom },
      },
    });
    const sameOrder = overlapping.find((l) => l.orderId === d.orderId);
    if (sameOrder) return sameOrder;
    if (overlapping.length > 0) {
      throw new ConflictException({
        code: 'SAMPLE_ID_ALREADY_LINKED',
        message: `Sample ${d.sampleId} is already linked to another order in that period. End that link first.`,
        orderIds: overlapping.map((l) => l.orderId),
      });
    }
    return this.prisma.instrumentSampleLink.create({
      data: { labTenantId, ...d },
    });
  }

  // ── Parameter mappings ───────────────────────────────────────────────────

  listMappings(labTenantId: string, analyzerId?: string) {
    return this.prisma.instrumentParameterMapping.findMany({
      where: { labTenantId, ...(analyzerId && { analyzerId }) },
      orderBy: [
        { analyzerId: 'asc' },
        { catalogItemCode: 'asc' },
        { parameterCode: 'asc' },
      ],
    });
  }

  async upsertMapping(labTenantId: string, dto: UpsertMappingDto) {
    const analyzer = await this.prisma.analyzer.findFirst({
      where: { id: dto.analyzerId, labTenantId },
      select: { id: true },
    });
    if (!analyzer)
      throw new NotFoundException('Analyzer not found in this laboratory.');
    const multiplier = dto.multiplier ?? 1;
    return this.prisma.instrumentParameterMapping.upsert({
      where: {
        analyzerId_parameterCode_analyzerUnit_catalogItemCode: {
          analyzerId: dto.analyzerId,
          parameterCode: dto.parameterCode,
          analyzerUnit: dto.analyzerUnit,
          catalogItemCode: dto.catalogItemCode,
        },
      },
      create: { labTenantId, ...dto, multiplier },
      update: { analyteCode: dto.analyteCode, multiplier },
    });
  }

  async deleteMapping(labTenantId: string, id: string) {
    const row = await this.prisma.instrumentParameterMapping.findFirst({
      where: { id, labTenantId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Mapping not found.');
    await this.prisma.instrumentParameterMapping.delete({ where: { id } });
    return { id };
  }
}
