import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { PrismaService } from '../prisma/prisma.service';
import type { ConnectorContext } from './connector-credential.service';
import {
  contentHash,
  decodeFrame,
  parseHl7Time,
  parseOru,
  peekHeader,
  toStoredSummary,
} from './hl7-oru';
import { InstrumentProcessorService } from './instrument-processor.service';

export interface IngestInput {
  connector: ConnectorContext;
  bytes: Buffer;
  /** sha256 hex the connector computed over the exact bytes */
  claimedSha256: string;
  receivedAt: Date;
  /** false = interrupted/unframed transfer: stored, never imported */
  complete: boolean;
  incompleteReason?: string;
  localId?: string;
  remoteAddress?: string;
}

export interface IngestResult {
  id: string;
  status: string;
  /** true when these exact bytes had already been uploaded (retry) — nothing new was stored */
  duplicateUpload: boolean;
}

@Injectable()
export class InstrumentIngestService {
  private readonly logger = new Logger(InstrumentIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: InstrumentProcessorService
  ) {}

  async ingest(input: IngestInput): Promise<IngestResult> {
    const { connector, bytes } = input;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== input.claimedSha256.toLowerCase()) {
      throw new BadRequestException(
        'Content hash mismatch: the body was altered or truncated in transit.'
      );
    }
    if (bytes.length === 0) throw new BadRequestException('Empty message.');

    const key = {
      labTenantId_analyzerId_sha256: {
        labTenantId: connector.labTenantId,
        analyzerId: connector.analyzerId,
        sha256,
      },
    };
    const existing = await this.prisma.instrumentMessage.findUnique({
      where: key,
      select: { id: true, status: true },
    });
    if (existing)
      return {
        id: existing.id,
        status: existing.status,
        duplicateUpload: true,
      };

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: connector.labTenantId },
      select: { timezone: true },
    });
    const record = this.classify(input, tenant?.timezone ?? 'UTC');

    let id: string;
    try {
      const created = await this.prisma.instrumentMessage.create({
        data: {
          labTenantId: connector.labTenantId,
          analyzerId: connector.analyzerId,
          credentialId: connector.credentialId,
          sha256,
          byteLength: bytes.length,
          receivedAtConnector: input.receivedAt,
          connectorLocalId: input.localId ?? null,
          remoteAddress: input.remoteAddress ?? null,
          ...record,
          payload: {
            create: {
              compression: 'gzip',
              bytes: new Uint8Array(gzipSync(bytes)),
            },
          },
        },
        select: { id: true },
      });
      id = created.id;
    } catch (err) {
      // Two uploads of the same bytes raced: the other one won.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await this.prisma.instrumentMessage.findUniqueOrThrow({
          where: key,
          select: { id: true, status: true },
        });
        return { id: winner.id, status: winner.status, duplicateUpload: true };
      }
      throw err;
    }

    if (record.isComplete && record.status === 'RECEIVED') {
      await this.resolveEarlierIncomplete(
        connector,
        id,
        record.controlId,
        record.sampleId
      );
      try {
        const status = await this.processor.process(id);
        return { id, status, duplicateUpload: false };
      } catch (err) {
        // Raw bytes are already durable; report the failure on the row, keep the upload successful.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Processing message ${id} failed: ${message}`);
        await this.prisma.instrumentMessage.update({
          where: { id },
          data: {
            status: 'FAILED',
            processingError: message.slice(0, 1000),
            reasons: ['PROCESSING_ERROR'],
          },
        });
        return { id, status: 'FAILED', duplicateUpload: false };
      }
    }
    return { id, status: record.status, duplicateUpload: false };
  }

  /** What to store for these bytes. Never throws: unparseable input becomes a FAILED row. */
  private classify(input: IngestInput, timeZone: string) {
    const { bytes } = input;
    if (!input.complete) {
      const peek = peekHeader(bytes);
      return {
        isComplete: false,
        incompleteReason: (
          input.incompleteReason ?? 'interrupted-transfer'
        ).slice(0, 100),
        status: 'INCOMPLETE' as const,
        reasons: ['INCOMPLETE_TRANSFER'],
        controlId: peek.controlId,
        sampleId: peek.sampleId,
        messageTime: peek.messageTime,
      };
    }
    try {
      const payload = decodeFrame(bytes);
      const oru = parseOru(payload);
      const flags = oru.observations.map((o) => o.userFlag);
      return {
        isComplete: true,
        status: 'RECEIVED' as const,
        reasons: [] as string[],
        controlId: oru.controlId,
        sampleId: oru.patient.sampleId,
        messageTime: oru.messageTime,
        observationTime: parseHl7Time(oru.observationTimeRaw, timeZone),
        contentHash: contentHash(oru, payload),
        hasAnalyzerEdits: flags.some((f) => f === 'E' || f === 'e'),
        hasExpiredReagent: flags.some((f) => f === 'O'),
        parsed: toStoredSummary(
          oru,
          payload
        ) as unknown as Prisma.InputJsonValue,
      };
    } catch (err) {
      return {
        isComplete: true,
        status: 'FAILED' as const,
        reasons: ['UNPARSEABLE_MESSAGE'],
        processingError: (err instanceof Error
          ? err.message
          : String(err)
        ).slice(0, 1000),
      };
    }
  }

  /** A complete copy of a message arrived: earlier interrupted attempts of it need no more attention. */
  private async resolveEarlierIncomplete(
    connector: ConnectorContext,
    messageId: string,
    controlId: string | null | undefined,
    sampleId: string | null | undefined
  ) {
    if (!controlId || !sampleId) return;
    await this.prisma.instrumentMessage.updateMany({
      where: {
        labTenantId: connector.labTenantId,
        analyzerId: connector.analyzerId,
        status: 'INCOMPLETE',
        resolvedAt: null,
        controlId,
        sampleId,
      },
      data: {
        resolvedAt: new Date(),
        reviewNote: `A complete copy arrived (message ${messageId}).`,
      },
    });
  }
}
