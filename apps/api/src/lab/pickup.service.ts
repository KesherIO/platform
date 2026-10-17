import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import {
  PickupStatus,
  TenantRole,
  TimelineEventType,
  Prisma,
  type Notification,
} from '@prisma/client';
import type { NotificationParams } from '@vet-ai/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import {
  NotificationDeliveryWorker,
  type DeliverySettlement,
} from '../notifications/notification-delivery.worker';
import {
  isWithinSchedule,
  type WeeklySchedule,
} from './messenger-schedule.util';
import { buildDateRangeFilter } from './date-range.util';
import type { ListPickupsDto } from './dto/list-pickups.dto';
import type { SavePushSubscriptionDto } from './dto/save-push-subscription.dto';

// Valid Pickup.status transitions — mirrors LAB_STATUS_TRANSITIONS in lab.service.ts
const PICKUP_STATUS_TRANSITIONS: Record<PickupStatus, PickupStatus[]> = {
  REQUESTED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['NOTIFIED', 'CANCELLED'],
  NOTIFIED: ['ACCEPTED', 'CANCELLED', 'FAILED'],
  ACCEPTED: ['COLLECTED', 'CANCELLED', 'FAILED'],
  COLLECTED: ['IN_TRANSIT'],
  IN_TRANSIT: ['RECEIVED_AT_LAB', 'FAILED'],
  RECEIVED_AT_LAB: [],
  CANCELLED: [],
  FAILED: [],
};

// Pickups still moving — the default scope for both the Collections queue and
// My Pickups when no explicit status filter is given, so completed/cancelled
// history doesn't pile up in the daily operational view. Callers that want
// history pass an explicit status filter (e.g. "RECEIVED_AT_LAB,CANCELLED,FAILED").
const ACTIVE_PICKUP_STATUSES: PickupStatus[] = [
  'REQUESTED',
  'ASSIGNED',
  'NOTIFIED',
  'ACCEPTED',
  'COLLECTED',
  'IN_TRANSIT',
];

const PROBLEM_REASONS = [
  'CLINIC_CLOSED',
  'SAMPLE_NOT_READY',
  'INCORRECT_ADDRESS',
  'UNABLE_TO_CONTACT',
  'OTHER',
];

function assertTransition(from: PickupStatus, to: PickupStatus) {
  const allowed = PICKUP_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(`Cannot transition from ${from} to ${to}.`);
  }
}

/** Pickup.notifyFailReason for a push that didn't reach the messenger. */
const NOTIFY_FAIL_REASON: Record<
  Exclude<DeliverySettlement, 'SENT'>,
  string
> = {
  SKIPPED: 'No active push subscription for messenger.',
  FAILED: 'Push delivery failed after several attempts.',
  EXPIRED: 'Push expired before it could be delivered.',
};

@Injectable()
export class PickupService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly deliveryWorker: NotificationDeliveryWorker
  ) {}

  onModuleInit() {
    this.deliveryWorker.onSettled('PICKUP_ASSIGNED', (n, settlement, detail) =>
      this.recordAssignmentPush(n, settlement, detail)
    );
  }

  // ---------------------------------------------------------------------------
  // Creation — called by OrdersService right after a LAB_PICKUP order is created
  // ---------------------------------------------------------------------------

  async createPickup(
    orderId: string,
    labTenantId: string,
    clinicTenantId: string,
    // The lab's collection settings for this clinic (ClinicLabConnection)
    collectionSettings: {
      pickupAddress: string | null;
      pickupContactName: string | null;
      pickupContactPhone: string | null;
      pickupInstructions: string | null;
    },
    priority: 'ROUTINE' | 'URGENT' | 'STAT'
  ) {
    const pickup = await this.prisma.pickup.create({
      data: {
        orderId,
        labTenantId,
        clinicTenantId,
        priority,
        pickupAddress: collectionSettings.pickupAddress,
        pickupContactName: collectionSettings.pickupContactName,
        pickupContactPhone: collectionSettings.pickupContactPhone,
        pickupInstructions: collectionSettings.pickupInstructions,
      },
    });

    await this.createTimelineEvent({
      orderId,
      pickupId: pickup.id,
      eventType: 'PICKUP_REQUESTED',
      description: 'Lab pickup requested.',
    });

    return pickup;
  }

  // ---------------------------------------------------------------------------
  // Assignment — ADMIN only
  // ---------------------------------------------------------------------------

  async assignMessenger(
    labTenantId: string,
    pickupId: string,
    messengerId: string,
    assignedByUserId: string
  ) {
    const pickup = await this.prisma.pickup.findFirst({
      where: { id: pickupId, labTenantId },
    });
    if (!pickup) throw new NotFoundException('Pickup not found.');

    const reassignable = ['REQUESTED', 'ASSIGNED', 'NOTIFIED'];
    if (!reassignable.includes(pickup.status)) {
      throw new BadRequestException(
        `Pickup is ${pickup.status} — messenger can only be (re)assigned while REQUESTED, ASSIGNED or NOTIFIED.`
      );
    }

    const membership = await this.prisma.userTenantMembership.findUnique({
      where: {
        userId_tenantId: { userId: messengerId, tenantId: labTenantId },
      },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (
      !membership ||
      (membership.role !== TenantRole.MESSENGER &&
        !membership.canPerformPickups)
    ) {
      throw new BadRequestException(
        'Target user is not authorized to perform pickups.'
      );
    }

    const now = new Date();
    const messengerName =
      [membership.user.firstName, membership.user.lastName]
        .filter(Boolean)
        .join(' ') || 'messenger';
    const previousMessengerId = pickup.messengerId;

    // Assignment and its notifications commit together; the push itself goes
    // out from the delivery worker (recordAssignmentPush records the outcome)
    await this.prisma.$transaction(async (tx) => {
      await tx.pickup.update({
        where: { id: pickupId },
        data: {
          messengerId,
          assignedAt: now,
          status: 'ASSIGNED',
          // A new assignment gets its own delivery outcome
          notifiedAt: null,
          notifyFailReason: null,
        },
      });

      await this.createTimelineEvent(
        {
          orderId: pickup.orderId,
          pickupId: pickup.id,
          eventType: 'PICKUP_ASSIGNED',
          actorId: assignedByUserId,
          description: `Assigned to ${messengerName}.`,
          metadata: { messengerId, messengerName },
        },
        tx
      );

      await tx.pickup.update({
        where: { id: pickupId },
        data: { status: 'NOTIFIED' },
      });

      const order = await tx.order.findUnique({
        where: { id: pickup.orderId },
        select: { requisitionNumber: true, status: true },
      });

      // Order.status mirrors pickup progress so the Orders Queue (which filters/
      // badges on Order.status, not Pickup.status) reflects it — only advance
      // from PENDING, never override a status a lab staffer already changed.
      if (order?.status === 'PENDING') {
        await tx.order.update({
          where: { id: pickup.orderId },
          data: { status: 'READY_FOR_PICKUP' },
        });
      }

      // The persisted assignedAt identifies this assignment: publishing it
      // again (a retried request) never notifies twice
      const assignment = now.toISOString();
      const params: NotificationParams = {
        requisitionNumber: order?.requisitionNumber,
        assignedAt: assignment,
      };
      await this.notifications.publish(tx, {
        type: 'PICKUP_ASSIGNED',
        tenantId: labTenantId,
        eventKey: `pickup:${pickup.id}:assigned:${assignment}`,
        recipientUserIds: [messengerId],
        orderId: pickup.orderId,
        pickupId: pickup.id,
        params,
      });
      if (previousMessengerId && previousMessengerId !== messengerId) {
        await this.notifications.publish(tx, {
          type: 'PICKUP_UNASSIGNED',
          tenantId: labTenantId,
          eventKey: `pickup:${pickup.id}:unassigned:${assignment}`,
          recipientUserIds: [previousMessengerId],
          orderId: pickup.orderId,
          pickupId: pickup.id,
          params: { requisitionNumber: order?.requisitionNumber },
        });
      }
    });
    this.notifications.deliverQueued();

    return this.getPickupById(labTenantId, pickupId);
  }

  // ---------------------------------------------------------------------------
  // Messenger actions — authorized by pickup.messengerId === userId, not role
  // ---------------------------------------------------------------------------

  async getMyPickups(
    labTenantId: string,
    userId: string,
    query: ListPickupsDto = {}
  ) {
    const statuses = query.status?.split(',') as PickupStatus[] | undefined;

    const pickups = await this.prisma.pickup.findMany({
      where: {
        labTenantId,
        messengerId: userId,
        status: statuses
          ? statuses.length === 1
            ? statuses[0]
            : { in: statuses }
          : { in: ACTIVE_PICKUP_STATUSES },
      },
      orderBy: [{ status: 'asc' }, { assignedAt: 'desc' }],
      include: this.detailInclude(),
    });
    return pickups.map((p) => this.formatPickup(p));
  }

  async acceptPickup(labTenantId: string, pickupId: string, userId: string) {
    const pickup = await this.getOwnedPickup(labTenantId, pickupId, userId);

    if (pickup.status === 'ACCEPTED') {
      return this.getPickupById(labTenantId, pickupId); // idempotent
    }
    assertTransition(pickup.status, 'ACCEPTED');

    await this.prisma.pickup.update({
      where: { id: pickupId },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });

    await this.createTimelineEvent({
      orderId: pickup.orderId,
      pickupId: pickup.id,
      eventType: 'PICKUP_ACCEPTED',
      actorId: userId,
      description: 'Messenger accepted the pickup.',
    });

    return this.getPickupById(labTenantId, pickupId);
  }

  async markCollected(labTenantId: string, pickupId: string, userId: string) {
    const pickup = await this.getOwnedPickup(labTenantId, pickupId, userId);

    if (pickup.status === 'COLLECTED' || pickup.status === 'IN_TRANSIT') {
      return this.getPickupById(labTenantId, pickupId); // idempotent
    }
    assertTransition(pickup.status, 'COLLECTED');

    const order = await this.prisma.order.findUnique({
      where: { id: pickup.orderId },
      select: { status: true },
    });

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.pickup.update({
        where: { id: pickupId },
        data: { status: 'IN_TRANSIT', collectedAt: now },
      }),
      this.prisma.order.update({
        where: { id: pickup.orderId },
        data: {
          collectedAt: now,
          ...(order?.status === 'PENDING' ||
          order?.status === 'READY_FOR_PICKUP'
            ? { status: 'COLLECTED' as const }
            : {}),
        },
      }),
    ]);

    await this.createTimelineEvent({
      orderId: pickup.orderId,
      pickupId: pickup.id,
      eventType: 'SAMPLE_COLLECTED',
      actorId: userId,
      description: 'Sample collected from the clinic.',
    });
    await this.createTimelineEvent({
      orderId: pickup.orderId,
      pickupId: pickup.id,
      eventType: 'IN_TRANSIT',
      description: 'Sample is in transit to the laboratory.',
    });

    return this.getPickupById(labTenantId, pickupId);
  }

  async reportProblem(
    labTenantId: string,
    pickupId: string,
    userId: string,
    reason: string,
    details?: string
  ) {
    const pickup = await this.getOwnedPickup(labTenantId, pickupId, userId);
    if (!PROBLEM_REASONS.includes(reason)) {
      throw new BadRequestException('Invalid problem reason.');
    }

    await this.createTimelineEvent({
      orderId: pickup.orderId,
      pickupId: pickup.id,
      eventType: 'PROBLEM_REPORTED',
      actorId: userId,
      description: `Messenger reported a problem: ${reason}.`,
      metadata: { reason, details: details ?? null },
    });

    return { reported: true };
  }

  private async getOwnedPickup(
    labTenantId: string,
    pickupId: string,
    userId: string
  ) {
    const pickup = await this.prisma.pickup.findFirst({
      where: { id: pickupId, labTenantId },
    });
    if (!pickup) throw new NotFoundException('Pickup not found.');
    if (pickup.messengerId !== userId) {
      throw new ForbiddenException('This pickup is not assigned to you.');
    }
    return pickup;
  }

  // ---------------------------------------------------------------------------
  // Lab staff actions
  // ---------------------------------------------------------------------------

  async confirmReceived(labTenantId: string, pickupId: string, userId: string) {
    const pickup = await this.prisma.pickup.findFirst({
      where: { id: pickupId, labTenantId },
    });
    if (!pickup) throw new NotFoundException('Pickup not found.');

    if (pickup.status === 'RECEIVED_AT_LAB') {
      return this.getPickupById(labTenantId, pickupId); // idempotent
    }
    assertTransition(pickup.status, 'RECEIVED_AT_LAB');

    const order = await this.prisma.order.findUnique({
      where: { id: pickup.orderId },
      select: { status: true },
    });

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.pickup.update({
        where: { id: pickupId },
        data: { status: 'RECEIVED_AT_LAB', receivedAt: now },
      }),
      this.prisma.order.update({
        where: { id: pickup.orderId },
        data: {
          receivedByLabAt: now,
          ...(order &&
          ['PENDING', 'READY_FOR_PICKUP', 'COLLECTED'].includes(order.status)
            ? { status: 'RECEIVED_BY_LAB' as const }
            : {}),
        },
      }),
    ]);

    await this.createTimelineEvent({
      orderId: pickup.orderId,
      pickupId: pickup.id,
      eventType: 'RECEIVED_AT_LAB',
      actorId: userId,
      description: 'Sample received at the laboratory.',
    });

    return this.getPickupById(labTenantId, pickupId);
  }

  async cancelPickup(
    labTenantId: string,
    pickupId: string,
    userId: string,
    reason?: string
  ) {
    const pickup = await this.prisma.pickup.findFirst({
      where: { id: pickupId, labTenantId },
    });
    if (!pickup) throw new NotFoundException('Pickup not found.');

    if (['RECEIVED_AT_LAB', 'CANCELLED', 'FAILED'].includes(pickup.status)) {
      throw new BadRequestException(
        `Cannot cancel a pickup that is already ${pickup.status}.`
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.pickup.update({
        where: { id: pickupId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          failReason: reason,
        },
      });

      await this.createTimelineEvent(
        {
          orderId: pickup.orderId,
          pickupId: pickup.id,
          eventType: 'PICKUP_CANCELLED',
          actorId: userId,
          description: reason
            ? `Pickup cancelled: ${reason}.`
            : 'Pickup cancelled.',
        },
        tx
      );

      if (pickup.messengerId) {
        const order = await tx.order.findUnique({
          where: { id: pickup.orderId },
          select: { requisitionNumber: true },
        });
        await this.notifications.publish(tx, {
          type: 'PICKUP_CANCELLED',
          tenantId: labTenantId,
          // A pickup is cancelled at most once
          eventKey: `pickup:${pickup.id}:cancelled`,
          recipientUserIds: [pickup.messengerId],
          orderId: pickup.orderId,
          pickupId: pickup.id,
          params: { requisitionNumber: order?.requisitionNumber },
        });
      }
    });
    this.notifications.deliverQueued();

    return this.getPickupById(labTenantId, pickupId);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async listPickups(labTenantId: string, query: ListPickupsDto) {
    const {
      status,
      search,
      messengerId,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 20,
    } = query;
    const statuses = status?.split(',') as PickupStatus[] | undefined;
    const createdAt = buildDateRangeFilter(dateFrom, dateTo);

    const conditions: Record<string, unknown>[] = [
      {
        labTenantId,
        status: statuses
          ? statuses.length === 1
            ? statuses[0]
            : { in: statuses }
          : { in: ACTIVE_PICKUP_STATUSES },
        ...(messengerId && { messengerId }),
        ...(createdAt && { createdAt }),
      },
    ];

    if (search) {
      conditions.push({
        OR: [
          {
            order: {
              requisitionNumber: { contains: search, mode: 'insensitive' },
            },
          },
          {
            order: {
              case: { patientName: { contains: search, mode: 'insensitive' } },
            },
          },
          { clinicTenant: { name: { contains: search, mode: 'insensitive' } } },
          {
            messenger: { firstName: { contains: search, mode: 'insensitive' } },
          },
          {
            messenger: { lastName: { contains: search, mode: 'insensitive' } },
          },
        ],
      });
    }

    const where = { AND: conditions };
    const skip = (page - 1) * pageSize;

    const [pickups, total] = await Promise.all([
      this.prisma.pickup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: this.detailInclude(),
      }),
      this.prisma.pickup.count({ where }),
    ]);

    return {
      data: pickups.map((p) => this.formatPickup(p)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getPickupById(labTenantId: string, pickupId: string) {
    const pickup = await this.prisma.pickup.findFirst({
      where: { id: pickupId, labTenantId },
      include: this.detailInclude(),
    });
    if (!pickup) throw new NotFoundException('Pickup not found.');
    return this.formatPickup(pickup);
  }

  async getAvailableMessengers(labTenantId: string) {
    const [memberships, tenant] = await Promise.all([
      this.prisma.userTenantMembership.findMany({
        where: {
          tenantId: labTenantId,
          OR: [{ role: TenantRole.MESSENGER }, { canPerformPickups: true }],
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, phone: true },
          },
        },
      }),
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: labTenantId },
        select: { timezone: true },
      }),
    ]);

    const counts = await this.prisma.pickup.groupBy({
      by: ['messengerId'],
      where: {
        labTenantId,
        messengerId: { in: memberships.map((m) => m.userId) },
        status: { notIn: ['RECEIVED_AT_LAB', 'CANCELLED', 'FAILED'] },
      },
      _count: { _all: true },
    });
    const countByMessenger = new Map(
      counts.map((c) => [c.messengerId, c._count._all])
    );

    return memberships
      .map((m) => {
        const isMessengerRole = m.role === TenantRole.MESSENGER;
        const schedule = isMessengerRole
          ? (m.schedule as WeeklySchedule | null)
          : null;
        return {
          userId: m.user.id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          phone: m.user.phone,
          role: m.role,
          activePickupCount: countByMessenger.get(m.user.id) ?? 0,
          schedule,
          isCurrentlyScheduled: isMessengerRole
            ? isWithinSchedule(schedule, tenant.timezone)
            : true,
        };
      })
      .sort(
        (a, b) =>
          Number(b.isCurrentlyScheduled) - Number(a.isCurrentlyScheduled)
      );
  }

  async getTimelineForOrder(labTenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    return this.prisma.timelineEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Push subscriptions
  // ---------------------------------------------------------------------------

  async savePushSubscription(userId: string, dto: SavePushSubscriptionDto) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
    });
    return { saved: true };
  }

  async removePushSubscription(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { removed: true };
  }

  /**
   * Delivery-worker hook for PICKUP_ASSIGNED: records on the pickup, and in
   * its timeline, whether the messenger got the push — what assignMessenger
   * did inline before pushes went through the shared notifications. Ignored
   * when the pickup has been reassigned since (that assignment records its own).
   */
  async recordAssignmentPush(
    notification: Notification,
    settlement: DeliverySettlement,
    detail: string | null
  ): Promise<void> {
    if (!notification.pickupId) return;
    const params = (notification.params ?? {}) as NotificationParams;
    const pickup = await this.prisma.pickup.findUnique({
      where: { id: notification.pickupId },
      select: { id: true, orderId: true, assignedAt: true, messengerId: true },
    });
    if (
      !pickup ||
      pickup.messengerId !== notification.recipientUserId ||
      pickup.assignedAt?.toISOString() !== params.assignedAt
    ) {
      return;
    }

    const sent = settlement === 'SENT';
    await this.prisma.pickup.update({
      where: { id: pickup.id },
      data: sent
        ? { notifiedAt: new Date(), notifyFailReason: null }
        : {
            notifyFailReason:
              // Skipped for another reason (push off, messenger no longer allowed)
              settlement === 'SKIPPED' &&
              detail &&
              detail !== 'No active push subscription'
                ? `${detail}.`
                : NOTIFY_FAIL_REASON[settlement],
          },
    });
    await this.createTimelineEvent({
      orderId: pickup.orderId,
      pickupId: pickup.id,
      eventType: sent ? 'NOTIFICATION_SENT' : 'NOTIFICATION_FAILED',
      description: sent
        ? 'Push notification sent to messenger.'
        : 'Push notification could not be delivered — messenger will see it on next app open.',
      metadata: { notificationId: notification.id, settlement },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private detailInclude() {
    return {
      order: {
        select: {
          requisitionNumber: true,
          case: { select: { patientName: true } },
        },
      },
      clinicTenant: { select: { name: true } },
      messenger: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
    } satisfies Prisma.PickupInclude;
  }

  private formatPickup(
    p: Prisma.PickupGetPayload<{
      include: ReturnType<PickupService['detailInclude']>;
    }>
  ) {
    const messengerName = p.messenger
      ? [p.messenger.firstName, p.messenger.lastName]
          .filter(Boolean)
          .join(' ') || null
      : null;

    return {
      id: p.id,
      orderId: p.orderId,
      requisitionNumber: p.order?.requisitionNumber ?? null,
      patientName: p.order?.case?.patientName ?? null,
      clinicName: p.clinicTenant?.name ?? null,
      status: p.status,
      priority: p.priority,
      pickupAddress: p.pickupAddress,
      pickupContactName: p.pickupContactName,
      pickupContactPhone: p.pickupContactPhone,
      pickupInstructions: p.pickupInstructions,
      requestedPickupTime: p.requestedPickupTime,
      messengerId: p.messengerId,
      messengerName,
      messengerPhone: p.messenger?.phone ?? null,
      assignedAt: p.assignedAt,
      notifiedAt: p.notifiedAt,
      acceptedAt: p.acceptedAt,
      collectedAt: p.collectedAt,
      receivedAt: p.receivedAt,
      cancelledAt: p.cancelledAt,
      failReason: p.failReason,
      createdAt: p.createdAt,
    };
  }

  private async createTimelineEvent(
    event: {
      orderId: string;
      pickupId?: string;
      eventType: TimelineEventType;
      actorId?: string;
      actorName?: string;
      description: string;
      metadata?: Record<string, unknown>;
    },
    db: Pick<Prisma.TransactionClient, 'timelineEvent'> = this.prisma
  ) {
    return db.timelineEvent.create({
      data: {
        orderId: event.orderId,
        pickupId: event.pickupId,
        eventType: event.eventType,
        actorId: event.actorId,
        actorName: event.actorName,
        description: event.description,
        metadata: event.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
