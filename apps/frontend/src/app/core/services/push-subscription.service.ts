import { Injectable, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { SwPush } from '@angular/service-worker';
import {
  Observable,
  catchError,
  from,
  map,
  of,
  switchMap,
  take,
  timeout,
} from 'rxjs';
import type { PushSubscriptionInput } from '@vet-ai/shared-types';
import { TenantService } from './tenant.service';

export type PushPermissionState =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'denied';

/**
 * Browser (web) push for the clinic app, through the Angular service worker.
 * Opt-in from the notification panel — browsers only ask after a click.
 * The service worker only runs in production builds, so in `nx serve` this
 * reports 'unsupported'.
 */
@Injectable({ providedIn: 'root' })
export class PushSubscriptionService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);
  // Optional so code that only signs out still works without the SW providers
  private readonly swPush = inject(SwPush, { optional: true });

  readonly permission = signal<PushPermissionState>(this.currentPermission());

  /** This browser currently has a push subscription */
  readonly subscribed = toSignal(
    this.swPush?.isEnabled
      ? this.swPush.subscription.pipe(map((s) => !!s))
      : of(false),
    { initialValue: false }
  );

  private get tenantHeaders() {
    return { headers: { 'x-tenant-id': this.tenant.activeTenantId() ?? '' } };
  }

  /** Asks for permission, subscribes this browser and registers it with the API. */
  enable(): Observable<void> {
    const swPush = this.swPush;
    if (!swPush?.isEnabled) return of(undefined);
    return this.http
      .get<{ publicKey: string | null }>(
        '/api/notifications/push/public-key',
        this.tenantHeaders
      )
      .pipe(
        take(1),
        switchMap(({ publicKey }) => {
          if (!publicKey) throw new Error('Web push is not configured');
          return from(
            swPush.requestSubscription({ serverPublicKey: publicKey })
          );
        }),
        switchMap((subscription) => {
          const json = subscription.toJSON();
          const body: PushSubscriptionInput = {
            endpoint: json.endpoint ?? subscription.endpoint,
            keys: {
              p256dh: json.keys?.['p256dh'] ?? '',
              auth: json.keys?.['auth'] ?? '',
            },
          };
          return this.http.post(
            '/api/notifications/push/subscription',
            body,
            this.tenantHeaders
          );
        }),
        map(() => {
          this.permission.set(this.currentPermission());
        }),
        catchError((err) => {
          this.permission.set(this.currentPermission());
          throw err;
        })
      );
  }

  /**
   * On sign-out: stop pushes to this browser for the user leaving. Never
   * fails or hangs — signing out must not depend on push.
   */
  removeForSignOut(): Observable<void> {
    const swPush = this.swPush;
    if (!swPush?.isEnabled) return of(undefined);
    return swPush.subscription.pipe(
      take(1),
      timeout(3000),
      switchMap((subscription) => {
        if (!subscription) return of(null);
        return this.http
          .delete('/api/notifications/push/subscription', {
            ...this.tenantHeaders,
            body: { endpoint: subscription.endpoint },
          })
          .pipe(
            catchError(() => of(null)),
            switchMap(() => from(swPush.unsubscribe()))
          );
      }),
      map(() => undefined),
      catchError(() => of(undefined))
    );
  }

  private currentPermission(): PushPermissionState {
    if (!this.swPush?.isEnabled || typeof Notification === 'undefined') {
      return 'unsupported';
    }
    return Notification.permission as PushPermissionState;
  }
}
