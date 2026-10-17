import { Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationType, Prisma, PushApp } from '@prisma/client';
import type {
  NotificationListResponse,
  NotificationModel,
  NotificationParams,
  NotificationUnreadCountResponse,
  PushSubscriptionInput,
} from '@vet-ai/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDeliveryWorker } from './notification-delivery.worker';
import { notificationLink } from './notification-content';
import { activeMemberIds } from './notification-access';

export interface PublishNotificationEvent {
  type: NotificationType;
  /** Clinic or lab the notification belongs to (and opens in) */
  tenantId: string;
  /**
   * Persisted id of the business event (release id, addition id, the
   * pickup's assignedAt…). Publishing the same event again is a no-op.
   */
  eventKey: string;
  /** Candidates; duplicates and non-ACTIVE members are dropped */
  recipientUserIds: string[];
  orderId?: string;
  pickupId?: string;
  params: NotificationParams;
}

export type InboxKind = 'CLINIC' | 'LAB';

const TENANT_TYPES: Record<InboxKind, ('CLINIC' | 'LAB' | 'PLATFORM')[]> = {
  CLINIC: ['CLINIC'],
  LAB: ['LAB', 'PLATFORM'],
};

const MAX_PAGE = 50;

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly worker: NotificationDeliveryWorker
  ) {}

  /**
   * Records the notifications for one business event, inside the caller's
   * transaction: if the action rolls back there is nothing to deliver, if it
   * commits the inbox rows (and their queued pushes) exist. Call
   * `deliverQueued()` after the commit to send pushes right away.
   * Returns how many recipients are notified.
   */
  async publish(
    tx: Prisma.TransactionClient,
    event: PublishNotificationEvent
  ): Promise<number> {
    const recipients = await activeMemberIds(tx, event.tenantId, [
      ...new Set(event.recipientUserIds),
    ]);
    if (recipients.length === 0) return 0;

    const dedupeKey = `${event.type}:${event.eventKey}`;
    await tx.notification.createMany({
      data: recipients.map((recipientUserId) => ({
        recipientUserId,
        tenantId: event.tenantId,
        type: event.type,
        dedupeKey,
        orderId: event.orderId ?? null,
        pickupId: event.pickupId ?? null,
        params: event.params as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });

    const notifications = await tx.notification.findMany({
      where: { dedupeKey, recipientUserId: { in: recipients } },
      select: { id: true },
    });
    await tx.notificationDelivery.createMany({
      data: notifications.map((n) => ({
        notificationId: n.id,
        channel: 'WEB_PUSH' as const,
      })),
      skipDuplicates: true,
    });
    return recipients.length;
  }

  /** After a publishing transaction commits: send its pushes now. */
  deliverQueued(): void {
    this.worker.kick();
  }

  async list(
    userId: string,
    tenantId: string,
    opts: { cursor?: string; limit?: number } = {}
  ): Promise<NotificationListResponse> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), MAX_PAGE);
    const rows = await this.prisma.notification.findMany({
      where: { recipientUserId: userId, tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: {
        order: { select: { case: { select: { patientName: true } } } },
      },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((n): NotificationModel => {
        const params = (n.params ?? {}) as NotificationParams;
        return {
          id: n.id,
          type: n.type,
          tenantId: n.tenantId,
          orderId: n.orderId ?? undefined,
          pickupId: n.pickupId ?? undefined,
          params,
          patientName: n.order?.case?.patientName ?? undefined,
          link: notificationLink(n.type, n.tenantId, params),
          readAt: n.readAt?.toISOString(),
          createdAt: n.createdAt.toISOString(),
        };
      }),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /**
   * Unread in the active clinic/lab, plus per-tenant counts for the user's
   * other ACTIVE memberships of the same kind (the clinic switcher shows them).
   */
  async unreadCount(
    userId: string,
    tenantId: string,
    kind: InboxKind
  ): Promise<NotificationUnreadCountResponse> {
    const otherTenantIds = (
      await this.prisma.userTenantMembership.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          tenantId: { not: tenantId },
          tenant: { type: { in: TENANT_TYPES[kind] } },
        },
        select: { tenantId: true },
      })
    ).map((m) => m.tenantId);

    const [count, others] = await Promise.all([
      this.prisma.notification.count({
        where: { recipientUserId: userId, tenantId, readAt: null },
      }),
      otherTenantIds.length
        ? this.prisma.notification.groupBy({
            by: ['tenantId'],
            where: {
              recipientUserId: userId,
              tenantId: { in: otherTenantIds },
              readAt: null,
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    return {
      count,
      otherTenants: others.map((o) => ({
        tenantId: o.tenantId,
        count: o._count._all,
      })),
    };
  }

  async markRead(
    userId: string,
    tenantId: string,
    notificationId: string
  ): Promise<{ read: true }> {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        recipientUserId: userId,
        tenantId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      // Already read is fine; someone else's (or another tenant's) is not found
      const exists = await this.prisma.notification.findFirst({
        where: { id: notificationId, recipientUserId: userId, tenantId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Notification not found.');
    }
    return { read: true };
  }

  async markAllRead(
    userId: string,
    tenantId: string
  ): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, tenantId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  async savePushSubscription(
    userId: string,
    app: PushApp,
    dto: PushSubscriptionInput
  ): Promise<{ saved: true }> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        app,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
      update: { userId, app, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
    });
    return { saved: true };
  }

  async removePushSubscription(
    userId: string,
    endpoint: string
  ): Promise<{ removed: true }> {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { removed: true };
  }
}
