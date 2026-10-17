import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Notification, NotificationType } from '@prisma/client';
import type { NotificationParams } from '@vet-ai/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { PushService, type PushOutcome } from './push.service';
import {
  notificationApp,
  notificationLink,
  pushTag,
  pushText,
} from './notification-content';
import { isRecipientStillAuthorized } from './notification-access';

const POLL_INTERVAL_MS = 5_000;
// Stale recovery runs every STALE_CHECK_EVERY poll cycles (~60 s at 5 s/cycle).
const STALE_CHECK_EVERY = 12;
const STALE_THRESHOLD_MS = 5 * 60_000;
// At most this many deliveries per cycle, so one cycle never runs for long.
const BATCH_SIZE = 25;
export const MAX_ATTEMPTS = 5;
// A push older than this is no longer worth showing.
export const PUSH_EXPIRY_MS = 24 * 60 * 60_000;

/** How a web-push delivery ended, for the per-type hooks. */
export type DeliverySettlement = 'SENT' | 'SKIPPED' | 'FAILED' | 'EXPIRED';

export type DeliverySettledHook = (
  notification: Notification,
  settlement: DeliverySettlement,
  detail: string | null
) => Promise<void>;

/**
 * Sends queued web pushes (notification_deliveries). Same pattern as the PDF
 * processor: one poll loop per API instance, rows claimed with
 * FOR UPDATE SKIP LOCKED and a claim token, so several instances never send
 * the same delivery. A failure only ever changes the delivery row — the
 * inbox notification and the business action that created it stay as they are.
 */
@Injectable()
export class NotificationDeliveryWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDeliveryWorker.name);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollCount = 0;
  private running = false;
  private kickRequested = false;
  private stopped = false;
  private readonly hooks = new Map<NotificationType, DeliverySettledHook>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService
  ) {}

  onModuleInit() {
    void this.runCycle();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  /**
   * Called after a business transaction that queued deliveries commits, so a
   * push goes out now rather than at the next poll.
   */
  kick(): void {
    if (this.stopped) return;
    if (this.running) {
      this.kickRequested = true;
      return;
    }
    if (this.pollTimer) clearTimeout(this.pollTimer);
    void this.runCycle();
  }

  /** Lets a feature react when its pushes settle (e.g. pickup notifiedAt). */
  onSettled(type: NotificationType, hook: DeliverySettledHook): void {
    this.hooks.set(type, hook);
  }

  private async runCycle(): Promise<void> {
    this.running = true;
    try {
      do {
        this.kickRequested = false;
        await this.processBatch();
      } while (this.kickRequested);
      this.pollCount++;
      if (this.pollCount % STALE_CHECK_EVERY === 0) {
        await this.recoverStale();
      }
    } catch (err) {
      this.logger.error('Notification delivery cycle error', err);
    } finally {
      this.running = false;
      if (!this.stopped) {
        this.pollTimer = setTimeout(
          () => void this.runCycle(),
          POLL_INTERVAL_MS
        );
      }
    }
  }

  /** Works through up to BATCH_SIZE due deliveries, one claim at a time. */
  async processBatch(): Promise<number> {
    let processed = 0;
    while (processed < BATCH_SIZE) {
      const claimed = await this.claimNext();
      if (!claimed) break;
      await this.deliver(claimed);
      processed++;
    }
    return processed;
  }

  private async claimNext(): Promise<{
    id: string;
    notificationId: string;
    attempts: number;
    claimToken: string;
  } | null> {
    const claimToken = randomUUID();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; notificationId: string; attempts: number }>
    >`
      UPDATE notification_deliveries
      SET status       = 'SENDING',
          "claimedAt"  = NOW(),
          "claimToken" = ${claimToken},
          attempts     = attempts + 1,
          "updatedAt"  = NOW()
      WHERE id = (
        SELECT id
        FROM   notification_deliveries
        WHERE  status = 'PENDING'
          AND  ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "notificationId", attempts
    `;
    if (rows.length === 0) return null;
    return {
      id: rows[0].id,
      notificationId: rows[0].notificationId,
      attempts: Number(rows[0].attempts),
      claimToken,
    };
  }

  private async deliver(delivery: {
    id: string;
    notificationId: string;
    attempts: number;
    claimToken: string;
  }): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: delivery.notificationId },
    });
    if (!notification) return; // cascade-deleted along with the delivery

    const params = (notification.params ?? {}) as NotificationParams;
    if (notification.dismissedAt) {
      // Cleared before its push could go out: nothing left to tell them
      return this.settle(delivery, notification, 'SKIPPED', 'Dismissed');
    }
    const age = Date.now() - notification.createdAt.getTime();
    if (age >= PUSH_EXPIRY_MS) {
      return this.settle(delivery, notification, 'EXPIRED', 'Too old to send');
    }

    if (
      !(await isRecipientStillAuthorized(this.prisma, {
        ...notification,
        params,
      }))
    ) {
      return this.settle(
        delivery,
        notification,
        'SKIPPED',
        'Recipient no longer authorized'
      );
    }

    const { title, body } = pushText(notification.type, params);
    let outcome: PushOutcome;
    try {
      outcome = await this.push.sendToUserApp(
        notification.recipientUserId,
        notificationApp(notification.type),
        {
          title,
          body,
          url: notificationLink(
            notification.type,
            notification.tenantId,
            params
          ),
          tag: pushTag(
            notification.type,
            notification.orderId,
            notification.pickupId,
            notification.id
          ),
        },
        Math.max(60, Math.floor((PUSH_EXPIRY_MS - age) / 1000))
      );
    } catch (err) {
      outcome = { kind: 'FAILED', error: (err as Error).message };
    }

    switch (outcome.kind) {
      case 'SENT':
        return this.settle(delivery, notification, 'SENT', null);
      case 'NO_SUBSCRIPTION':
        return this.settle(
          delivery,
          notification,
          'SKIPPED',
          'No active push subscription'
        );
      case 'NOT_CONFIGURED':
        return this.settle(
          delivery,
          notification,
          'SKIPPED',
          'Web push is not configured'
        );
      case 'FAILED':
        if (delivery.attempts >= MAX_ATTEMPTS) {
          return this.settle(delivery, notification, 'FAILED', outcome.error);
        }
        await this.prisma.notificationDelivery.updateMany({
          where: { id: delivery.id, claimToken: delivery.claimToken },
          data: {
            status: 'PENDING',
            claimedAt: null,
            claimToken: null,
            nextAttemptAt: new Date(
              Date.now() + retryBackoffMs(delivery.attempts)
            ),
            lastError: outcome.error.slice(0, 500),
          },
        });
    }
  }

  private async settle(
    delivery: { id: string; claimToken: string },
    notification: Notification,
    settlement: DeliverySettlement,
    detail: string | null
  ): Promise<void> {
    const { count } = await this.prisma.notificationDelivery.updateMany({
      where: { id: delivery.id, claimToken: delivery.claimToken },
      data: {
        status: settlement,
        claimedAt: null,
        claimToken: null,
        nextAttemptAt: null,
        lastError: detail?.slice(0, 500) ?? null,
        ...(settlement === 'SENT' ? { sentAt: new Date() } : {}),
      },
    });
    if (count === 0) {
      this.logger.warn(
        `Delivery ${delivery.id} was reclaimed by another worker — discarding`
      );
      return;
    }

    const hook = this.hooks.get(notification.type);
    if (hook) {
      await hook(notification, settlement, detail).catch((err) =>
        this.logger.error(
          `Settled hook failed for ${notification.type} ${notification.id}`,
          err
        )
      );
    }
  }

  private async recoverStale(): Promise<void> {
    const { count } = await this.prisma.notificationDelivery.updateMany({
      where: {
        status: 'SENDING',
        claimedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
      },
      data: { status: 'PENDING', claimedAt: null, claimToken: null },
    });
    if (count > 0) {
      this.logger.warn(`Recovered ${count} stale SENDING deliveries`);
    }
  }
}

/** 30 s, 2 min, 10 min, then 30 min between attempts. */
export function retryBackoffMs(attemptsSoFar: number): number {
  const delays = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
  return delays[Math.min(attemptsSoFar, delays.length) - 1] ?? delays[0];
}
