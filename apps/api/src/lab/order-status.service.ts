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

    const hasAccepted = specimens.some((s) => s.status === 'ACCEPTED');
    const hasExpectedOrReceived = specimens.some(
      (s) => s.status === 'EXPECTED' || s.status === 'RECEIVED'
    );
    const hasMissing = specimens.some((s) => s.status === 'MISSING');
    const hasReadyTest = tests.some((t) => t.status === 'READY');
    if (
      (hasAccepted && !hasExpectedOrReceived && !hasMissing) ||
      hasReadyTest
    ) {
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
      select: { status: true, caseId: true },
    });

    let changed = false;
    if (order.status !== derivedOrder) {
      const timestamps: Record<string, Date | null> = {};
      const now = new Date();
      if (derivedOrder === 'RECEIVED_BY_LAB') timestamps.receivedByLabAt = now;
      if (derivedOrder === 'PROCESSING') timestamps.processingStartedAt = now;
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
}
