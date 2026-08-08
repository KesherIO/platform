import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

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

  /**
   * Sends the same payload to every device/browser this user has subscribed
   * from. Returns true if at least one send succeeded — callers should treat
   * `false` as a soft failure, not an error (the pickup is still visible in
   * the app either way).
   */
  async sendToUser(
    userId: string,
    payload: { title: string; body: string; url: string }
  ): Promise<boolean> {
    if (!this.configured) return false;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) return false;

    const results = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload)
          );
          return true;
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
          } else {
            this.logger.warn(
              `Push send failed for subscription ${sub.id}: ${
                (err as Error).message
              }`
            );
          }
          return false;
        }
      })
    );

    return results.some(Boolean);
  }
}
