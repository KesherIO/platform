import { Injectable } from '@nestjs/common';
import type { OrderStatus, CaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const TERMINAL_TEST_STATUSES = new Set(['COMPLETED', 'CANCELLED']);

const PROCESSING_TEST_STATUSES = new Set([
  'IN_PROGRESS',
  'RESULTS_ENTERED',
  'IN_REVIEW',
]);

@Injectable()
export class OrderStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async deriveOrderStatus(orderId: string): Promise<OrderStatus> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    if (order.status === 'CANCELLED') return 'CANCELLED';

    const [tests, specimens] = await Promise.all([
      this.prisma.orderedTest.findMany({
        where: { orderId },
        select: { status: true },
      }),
      this.prisma.specimen.findMany({
        where: { orderId },
        select: { status: true },
      }),
    ]);

    if (
      tests.length > 0 &&
      tests.every((t) => TERMINAL_TEST_STATUSES.has(t.status))
    ) {
      return 'COMPLETED';
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
    if ((hasAccepted && !hasExpectedOrReceived && !hasMissing) || hasReadyTest) {
      return 'RECEIVED_BY_LAB';
    }

    return 'PENDING';
  }

  async deriveAndPersist(orderId: string): Promise<{
    orderStatus: OrderStatus;
    caseStatus: CaseStatus | null;
    changed: boolean;
  }> {
    const derivedOrder = await this.deriveOrderStatus(orderId);

    const order = await this.prisma.order.findUniqueOrThrow({
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

      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: derivedOrder, ...timestamps },
      });
      changed = true;
    }

    let derivedCase: CaseStatus | null = null;
    if (derivedOrder === 'COMPLETED') {
      const caseRow = await this.prisma.case.findUnique({
        where: { id: order.caseId },
        select: { status: true },
      });
      if (caseRow && caseRow.status !== 'CANCELLED' && caseRow.status !== 'COMPLETED') {
        await this.prisma.case.update({
          where: { id: order.caseId },
          data: { status: 'COMPLETED' },
        });
        derivedCase = 'COMPLETED';
        changed = true;
      }
    }

    return { orderStatus: derivedOrder, caseStatus: derivedCase, changed };
  }
}
