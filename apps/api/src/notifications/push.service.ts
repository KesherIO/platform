import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import type { PushApp } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  title: string;
  body: string;
  /** In-app path opened when the notification is tapped */
  url: string;
  /** A newer push with the same tag replaces the older one on the device */
  tag: string;
}

/** What happened to one push across all of a user's devices for one app. */
export type PushOutcome =
  | { kind: 'SENT' }
  | { kind: 'NO_SUBSCRIPTION' } // nothing to send to (or every device unsubscribed)
  | { kind: 'NOT_CONFIGURED' }
  | { kind: 'FAILED'; error: string }; // transient: worth retrying

/** Icon each app's service worker shows (served by that app). */
const APP_ICON: Record<PushApp, string> = {
  LAB: '/icon-128x128.png',
  CLINIC: '/assets/icons/icon-192.png',
};

/**
 * Sends "you have a new pickup" alerts via the browser's built-in Web Push
 * API — no third-party messaging vendor, no per-message cost, no account.
 *
 * Setup (one-time, free, no vendor sign-up):
 *   1. Generate a VAPID keypair: `npx web-push generate-vapid-keys`.
 *   2. Set env vars:
 *        VAPID_PUBLIC_KEY  — also exposed to the lab frontend build as
 *                            VITE_VAPID_PUBLIC_KEY (public keys are safe to
 *                            ship client-side; only the private key is secret).
 *        VAPID_PRIVATE_KEY
 *        VAPID_SUBJECT     — a contact URI, e.g. "mailto:ops@example.com".
 *   3. Messengers grant notification permission once from /my-pickups in the
 *      lab app, which POSTs their browser's subscription to this API.
 *
 * If a subscription's push service responds 404/410 (Gone), the browser has
 * unsubscribed or the subscription expired — we delete it so we stop trying.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;
  private publicKey: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT');

    if (publicKey && privateKey && subject) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.configured = true;
      this.publicKey = publicKey;
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not set — push notifications are disabled. ' +
          'Messengers will still see new pickups next time they open the app.'
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /** VAPID public key browsers subscribe with (safe to expose); null when off. */
  getPublicKey(): string | null {
    return this.publicKey;
  }

  /**
   * Sends one notification to every device on which `userId` subscribed from
   * `app`. Devices that unsubscribed (404/410) are deleted; any other error
   * makes the whole push FAILED so the caller can retry it — devices that
   * already got it simply replace it (same tag).
   */
  async sendToUserApp(
    userId: string,
    app: PushApp,
    message: PushMessage,
    ttlSeconds: number
  ): Promise<PushOutcome> {
    if (!this.configured) return { kind: 'NOT_CONFIGURED' };

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId, app },
    });
    if (subscriptions.length === 0) return { kind: 'NO_SUBSCRIPTION' };

    const payload = JSON.stringify(this.payloadFor(app, message));
    const results = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            { TTL: ttlSeconds }
          );
          return 'sent' as const;
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
            return 'gone' as const;
          }
          const error = (err as Error).message;
          this.logger.warn(
            `Push send failed for subscription ${sub.id}: ${error}`
          );
          return { error };
        }
      })
    );

    const failed = results.find(
      (r): r is { error: string } => typeof r === 'object'
    );
    if (failed) return { kind: 'FAILED', error: failed.error };
    return results.includes('sent')
      ? { kind: 'SENT' }
      : { kind: 'NO_SUBSCRIPTION' };
  }

  /**
   * The lab's sw.js reads { title, body, url, tag }; the clinic's Angular
   * service worker (ngsw) expects a `notification` object and opens
   * data.onActionClick.default.url on tap.
   */
  private payloadFor(app: PushApp, message: PushMessage) {
    if (app === 'LAB') return { ...message, icon: APP_ICON.LAB };
    return {
      notification: {
        title: message.title,
        body: message.body,
        tag: message.tag,
        icon: APP_ICON.CLINIC,
        data: {
          onActionClick: {
            default: {
              operation: 'navigateLastFocusedOrOpen',
              url: message.url,
            },
          },
        },
      },
    };
  }
}
