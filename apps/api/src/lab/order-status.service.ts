import { Injectable } from '@nestjs/common';
import type { OrderStatus, CaseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type TxClient = Prisma.TransactionClient;

const TERMINAL_TEST_STATUSES = new Set(['COMPLETED', 'CANCELLED']);

const PROCESSING_TEST_STATUSES = new Set([
  'IN_PROGRESS',
  'RESULTS_ENTERED',
  'IN_REVIEW',
]);

/**
 * Tubes the order is still waiting on, shown next to its status: only while
 * an unfinished, non-cancelled test still needs them — a tube that was
 * replaced, or whose tests finished or were cancelled, doesn't count.
 */
export interface OutstandingSpecimens {
  /** Requested (e.g. for added tests), not received yet */
  awaiting: number;
  /** Marked missing; its tests are blocked waiting for it */
  missing: number;
  /** Rejected and not replaced yet; its tests are blocked */
  rejected: number;
}

export const NONE_OUTSTANDING: OutstandingSpecimens = {
  awaiting: 0,
  missing: 0,
  rejected: 0,
};

@Injectable()
export class OrderStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async deriveOrderStatus(
    orderId: string,
    tx?: TxClient
  ): Promise<OrderStatus> {
    const db = tx ?? this.prisma;
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    if (order.status === 'CANCELLED') return 'CANCELLED';

    const [tests, specimens] = await Promise.all([
      db.orderedTest.findMany({
        where: { orderId },
        select: { status: true },
      }),
      db.specimen.findMany({
        where: { orderId },
        select: { status: true },
      }),
    ]);

    if (
      tests.length > 0 &&
      tests.every((t) => TERMINAL_TEST_STATUSES.has(t.status))
    ) {
      return tests.every((t) => t.status === 'CANCELLED')
        ? 'CANCELLED'
        : 'COMPLETED';
    }

    if (tests.some((t) => PROCESSING_TEST_STATUSES.has(t.status))) {
      return 'PROCESSING';
    }

    // Once a tube has been accepted the sample is at the lab: tubes still
    // awaited, missing or rejected show as outstanding next to the status
    // (outstandingSpecimens) instead of sending the order back to PENDING
    const hasAccepted = specimens.some((s) => s.status === 'ACCEPTED');
    const hasReadyTest = tests.some((t) => t.status === 'READY');
    if (hasAccepted || hasReadyTest) {
      return 'RECEIVED_BY_LAB';
    }

    return 'PENDING';
  }

  async deriveAndPersist(
    orderId: string,
    tx?: TxClient
  ): Promise<{
    orderStatus: OrderStatus;
    caseStatus: CaseStatus | null;
    changed: boolean;
  }> {
    const db = tx ?? this.prisma;
    const derivedOrder = await this.deriveOrderStatus(orderId, tx);

    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        caseId: true,
        receivedByLabAt: true,
        processingStartedAt: true,
      },
    });

    let changed = false;
    if (order.status !== derivedOrder) {
      const timestamps: Record<string, Date | null> = {};
      const now = new Date();
      // First arrival / first processing only — an order going back from
      // PROCESSING to RECEIVED_BY_LAB (e.g. a test added) keeps its history
      if (derivedOrder === 'RECEIVED_BY_LAB' && !order.receivedByLabAt) {
        timestamps.receivedByLabAt = now;
      }
      if (derivedOrder === 'PROCESSING' && !order.processingStartedAt) {
        timestamps.processingStartedAt = now;
      }
      if (derivedOrder === 'COMPLETED') timestamps.completedAt = now;

      if (derivedOrder === 'CANCELLED') timestamps.cancelledAt = now;

      await db.order.update({
        where: { id: orderId },
        data: { status: derivedOrder, ...timestamps },
      });
      changed = true;
    }

    let derivedCase: CaseStatus | null = null;
    if (derivedOrder === 'COMPLETED' || derivedOrder === 'CANCELLED') {
      const caseRow = await db.case.findUnique({
        where: { id: order.caseId },
        select: { status: true },
      });
      if (
        caseRow &&
        caseRow.status !== 'CANCELLED' &&
        caseRow.status !== 'COMPLETED'
      ) {
        const caseStatus: CaseStatus =
          derivedOrder === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
        await db.case.update({
          where: { id: order.caseId },
          data: { status: caseStatus },
        });
        derivedCase = caseStatus;
        changed = true;
      }
    }

    return { orderStatus: derivedOrder, caseStatus: derivedCase, changed };
  }

  /** Outstanding tubes per order (see OutstandingSpecimens). */
  async outstandingSpecimens(
    orderIds: string[],
    tx?: TxClient
  ): Promise<Map<string, OutstandingSpecimens>> {
    const db = tx ?? this.prisma;
    const result = new Map<string, OutstandingSpecimens>();
    if (orderIds.length === 0) return result;

    const specimens = await db.specimen.findMany({
      where: {
        orderId: { in: orderIds },
        status: { in: ['EXPECTED', 'MISSING', 'REJECTED'] },
      },
      select: {
        orderId: true,
        status: true,
        orderedTests: {
          select: {
            orderedTest: { select: { status: true, blockReason: true } },
          },
        },
      },
    });

    for (const sp of specimens) {
      const tests = sp.orderedTests.map((l) => l.orderedTest);
      const stillNeeded =
        sp.status === 'EXPECTED'
          ? tests.some((t) => t.status === 'PENDING')
          : sp.status === 'MISSING'
          ? tests.some(
              (t) =>
                t.status === 'BLOCKED' && t.blockReason === 'MISSING_SPECIMEN'
            )
          : tests.some(
              (t) =>
                t.status === 'BLOCKED' && t.blockReason === 'REJECTED_SPECIMEN'
            );
      if (!stillNeeded) continue;

      const counts = result.get(sp.orderId) ?? { ...NONE_OUTSTANDING };
      if (sp.status === 'EXPECTED') counts.awaiting++;
      else if (sp.status === 'MISSING') counts.missing++;
      else counts.rejected++;
      result.set(sp.orderId, counts);
    }
    return result;
  }
}
