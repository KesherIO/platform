import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requisitionForAnalyzerNumber } from '../orders/analyzer-number.util';

/** Allowed difference between the analyzer's clock and ours when checking run times. */
export const CLOCK_SKEW_MS = 3_600_000;

export interface OrderMatchInput {
  /** From the connector credential — never from the message. */
  labTenantId: string;
  analyzerId: string;
  /** PID-3 as sent */
  sampleId: string;
  /** When the analyzer ran the sample (OBR-7, lab time zone), else when the connector received it */
  runAt: Date;
  /** Analyzer setting: also match by the order's analyzer number */
  autoMatchOrders: boolean;
}

export type OrderMatch =
  | { status: 'UNMATCHED' | 'AMBIGUOUS'; reasons: string[] }
  | {
      status: 'MATCHED';
      orderId: string;
      sampleLinkId: string | null;
      matchedBy: 'SAMPLE_LINK' | 'ORDER_NUMBER';
      /** ORDER_NUMBER_LINK_CONFLICT when the number points elsewhere (approvable: the link wins) */
      reasons: string[];
    };

/**
 * Which order an analyzer result belongs to. Analyzer-agnostic: it knows nothing about HL7 or
 * any device, only (lab, analyzer, sample ID, run time). Two explicit sources, nothing inferred:
 *
 *  1. an InstrumentSampleLink for this lab + analyzer + sample ID whose window covers the run;
 *  2. if the analyzer has autoMatchOrders on: the sample ID read as the order's analyzer number
 *     (exactly 8 digits → REQ-20YY-NNNNNN), looked up by the lab's unique requisition number.
 *
 * Never by patient name, fuzzy search or "nearby" numbers.
 */
@Injectable()
export class OrderMatchService {
  constructor(private readonly prisma: PrismaService) {}

  async match(input: OrderMatchInput): Promise<OrderMatch> {
    const { labTenantId, analyzerId, sampleId, runAt } = input;
    const links = await this.prisma.instrumentSampleLink.findMany({
      where: {
        labTenantId,
        analyzerId,
        sampleId,
        endedAt: null,
        validFrom: { lte: runAt },
        validUntil: { gte: runAt },
      },
      select: { id: true, orderId: true },
    });
    const linkOrderIds = [...new Set(links.map((l) => l.orderId))];
    if (linkOrderIds.length > 1)
      return { status: 'AMBIGUOUS', reasons: ['AMBIGUOUS_SAMPLE'] };

    const byNumber = input.autoMatchOrders
      ? await this.byAnalyzerNumber(labTenantId, sampleId, runAt)
      : null;

    if (linkOrderIds.length === 1) {
      const link = links[0];
      // A person linked this sample explicitly. If the number names another order, say so:
      // a reviewer may approve it, and then the link wins.
      const conflict =
        byNumber && 'orderId' in byNumber && byNumber.orderId !== link.orderId
          ? [`ORDER_NUMBER_LINK_CONFLICT:${byNumber.requisitionNumber}`]
          : [];
      return {
        status: 'MATCHED',
        orderId: link.orderId,
        sampleLinkId: link.id,
        matchedBy: 'SAMPLE_LINK',
        reasons: conflict,
      };
    }
    if (byNumber && 'orderId' in byNumber) {
      return {
        status: 'MATCHED',
        orderId: byNumber.orderId,
        sampleLinkId: null,
        matchedBy: 'ORDER_NUMBER',
        reasons: [],
      };
    }
    return {
      status: 'UNMATCHED',
      reasons: ['UNMATCHED', ...(byNumber ? [byNumber.reason] : [])],
    };
  }

  private async byAnalyzerNumber(
    labTenantId: string,
    sampleId: string,
    runAt: Date
  ): Promise<
    { orderId: string; requisitionNumber: string } | { reason: string }
  > {
    const requisitionNumber = requisitionForAnalyzerNumber(sampleId);
    if (!requisitionNumber) return { reason: 'NOT_AN_ORDER_NUMBER' };
    // (labTenantId, requisitionNumber) is unique: at most one order, and only this lab's.
    const order = await this.prisma.order.findFirst({
      where: { labTenantId, requisitionNumber },
      select: { id: true, createdAt: true },
    });
    if (!order)
      return { reason: `ORDER_NUMBER_NOT_FOUND:${requisitionNumber}` };
    // A run before the order existed is a reused or mistyped number, not this order.
    if (runAt.getTime() < order.createdAt.getTime() - CLOCK_SKEW_MS)
      return { reason: `RUN_BEFORE_ORDER_CREATED:${requisitionNumber}` };
    return { orderId: order.id, requisitionNumber };
  }
}
