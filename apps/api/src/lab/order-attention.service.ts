import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderPriority, OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AttentionSeverity = 'HIGH' | 'CRITICAL';

export interface AttentionReason {
  code:
    | 'STAT_PRIORITY'
    | 'URGENT_PRIORITY'
    | 'SLA_BREACH_PENDING'
    | 'SLA_BREACH_RECEIVED'
    | 'SLA_BREACH_PROCESSING'
    | 'UNREVIEWED_ABNORMAL_RESULT';
  message: string;
  severity: AttentionSeverity;
  elapsedMinutes?: number;
  thresholdMinutes?: number;
}

export interface OrderNeedingAttention {
  orderId: string;
  requisitionNumber: string;
  status: OrderStatus;
  priority: OrderPriority;
  patientName: string;
  patientSpecies: string;
  clinicName: string;
  ageMinutes: number;
  severity: AttentionSeverity;
  attentionReasons: AttentionReason[];
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  HIGH: 1,
  CRITICAL: 2,
};

const OPEN_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.COLLECTED,
  OrderStatus.RECEIVED_BY_LAB,
  OrderStatus.PROCESSING,
];

@Injectable()
export class OrderAttentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  /**
   * Deterministic attention rules — never delegated to the LLM. Every order
   * returned carries the explicit reason(s) it matched, so the result is
   * explainable rather than inferred.
   */
  async getOrdersNeedingAttention(
    labTenantId: string
  ): Promise<OrderNeedingAttention[]> {
    const now = new Date();

    const orders = await this.prisma.order.findMany({
      where: {
        labTenantId,
        status: { in: OPEN_STATUSES },
      },
      include: {
        case: {
          select: { patientName: true, patientSpecies: true },
        },
        tenant: { select: { name: true } },
        resultReport: {
          select: {
            status: true,
            analytes: { select: { flag: true } },
          },
        },
      },
    });

    const pendingSlaMinutes = this.config.get<number>(
      'LAB_ORDER_SLA_PENDING_MINUTES',
      240
    );
    const receivedSlaMinutes = this.config.get<number>(
      'LAB_ORDER_SLA_RECEIVED_MINUTES',
      240
    );
    const processingSlaMinutes = this.config.get<number>(
      'LAB_ORDER_SLA_PROCESSING_MINUTES',
      480
    );

    const results: OrderNeedingAttention[] = [];

    for (const order of orders) {
      const reasons: AttentionReason[] = [];

      if (order.priority === OrderPriority.STAT) {
        reasons.push({
          code: 'STAT_PRIORITY',
          message: 'STAT priority order is not yet completed.',
          severity: 'CRITICAL',
        });
      } else if (order.priority === OrderPriority.URGENT) {
        reasons.push({
          code: 'URGENT_PRIORITY',
          message: 'URGENT priority order is not yet completed.',
          severity: 'HIGH',
        });
      }

      if (order.status === OrderStatus.PENDING) {
        const elapsedMinutes = minutesSince(order.createdAt, now);
        if (elapsedMinutes > pendingSlaMinutes) {
          reasons.push({
            code: 'SLA_BREACH_PENDING',
            message: `In PENDING for ${formatDuration(
              elapsedMinutes
            )}, exceeds the ${formatDuration(pendingSlaMinutes)} SLA.`,
            severity: 'HIGH',
            elapsedMinutes,
            thresholdMinutes: pendingSlaMinutes,
          });
        }
      }

      if (
        order.status === OrderStatus.RECEIVED_BY_LAB &&
        order.receivedByLabAt
      ) {
        const elapsedMinutes = minutesSince(order.receivedByLabAt, now);
        if (elapsedMinutes > receivedSlaMinutes) {
          reasons.push({
            code: 'SLA_BREACH_RECEIVED',
            message: `In RECEIVED_BY_LAB for ${formatDuration(
              elapsedMinutes
            )}, exceeds the ${formatDuration(receivedSlaMinutes)} SLA.`,
            severity: 'HIGH',
            elapsedMinutes,
            thresholdMinutes: receivedSlaMinutes,
          });
        }
      }

      if (
        order.status === OrderStatus.PROCESSING &&
        order.processingStartedAt
      ) {
        const elapsedMinutes = minutesSince(order.processingStartedAt, now);
        if (elapsedMinutes > processingSlaMinutes) {
          reasons.push({
            code: 'SLA_BREACH_PROCESSING',
            message: `In PROCESSING for ${formatDuration(
              elapsedMinutes
            )}, exceeds the ${formatDuration(processingSlaMinutes)} SLA.`,
            severity: 'HIGH',
            elapsedMinutes,
            thresholdMinutes: processingSlaMinutes,
          });
        }
      }

      const hasUnreviewedAbnormalResult =
        order.resultReport?.status === 'DRAFT' &&
        order.resultReport.analytes.some(
          (a) => a.flag === 'H' || a.flag === 'L'
        );
      if (hasUnreviewedAbnormalResult) {
        reasons.push({
          code: 'UNREVIEWED_ABNORMAL_RESULT',
          message:
            'Result report has abnormal (H/L) analyte values and is still in DRAFT, awaiting review/release.',
          severity: 'HIGH',
        });
      }

      if (reasons.length === 0) continue;

      const severity = reasons.reduce<AttentionSeverity>(
        (max, r) =>
          SEVERITY_RANK[r.severity] > SEVERITY_RANK[max] ? r.severity : max,
        'HIGH'
      );

      results.push({
        orderId: order.id,
        requisitionNumber: order.requisitionNumber,
        status: order.status,
        priority: order.priority,
        patientName: order.case.patientName,
        patientSpecies: order.case.patientSpecies,
        clinicName: order.tenant.name,
        ageMinutes: minutesSince(order.createdAt, now),
        severity,
        attentionReasons: reasons,
      });
    }

    return results;
  }
}

function minutesSince(start: Date, now: Date): number {
  return Math.floor((now.getTime() - start.getTime()) / 60_000);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}
