import { Injectable, inject, signal, DestroyRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Observable,
  catchError,
  filter,
  fromEvent,
  merge,
  switchMap,
  take,
  timer,
} from 'rxjs';
import type {
  NotificationListResponse,
  NotificationModel,
  NotificationUnreadCountResponse,
} from '@vet-ai/shared-types';
import { TenantService } from './tenant.service';

const POLL_MS = 60_000;
const PAGE_SIZE = 20;

/**
 * The signed-in user's notification inbox for the active clinic, plus unread
 * counts for their other clinics (shown in the clinic switcher).
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);

  readonly unreadCount = signal(0);
  /** tenantId → unread, for the user's other clinics */
  readonly otherClinicUnread = signal<Record<string, number>>({});
  readonly items = signal<NotificationModel[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal(false);

  constructor() {
    // Another clinic, another inbox
    this.tenant.registerCacheCleaner(() => {
      this.items.set([]);
      this.nextCursor.set(null);
      this.unreadCount.set(0);
      this.refreshUnread();
    });
  }

  private get tenantHeaders() {
    return { headers: { 'x-tenant-id': this.tenant.activeTenantId() ?? '' } };
  }

  /**
   * Keeps the unread counts fresh while `destroyRef`'s owner lives: every
   * minute while the tab is visible, and whenever the window regains focus.
   */
  startPolling(destroyRef: DestroyRef): void {
    merge(timer(0, POLL_MS), fromEvent(window, 'focus'))
      .pipe(
        filter(
          () =>
            !!this.tenant.activeTenantId() &&
            document.visibilityState === 'visible'
        ),
        switchMap(() => this.fetchUnread().pipe(catchError(() => EMPTY))),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe((res) => this.applyUnread(res));
  }

  refreshUnread(): void {
    if (!this.tenant.activeTenantId()) return;
    this.fetchUnread()
      .pipe(
        take(1),
        catchError(() => EMPTY)
      )
      .subscribe((res) => this.applyUnread(res));
  }

  loadFirstPage(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.fetchPage()
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.nextCursor.set(res.nextCursor);
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loading()) return;
    this.loading.set(true);
    this.fetchPage(cursor)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          this.items.update((items) => [...items, ...res.items]);
          this.nextCursor.set(res.nextCursor);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  /** Marks one read right away in the UI; the server catches up. */
  markRead(notification: NotificationModel): void {
    if (notification.readAt) return;
    const readAt = new Date().toISOString();
    this.items.update((items) =>
      items.map((n) => (n.id === notification.id ? { ...n, readAt } : n))
    );
    this.unreadCount.update((c) => Math.max(0, c - 1));
    this.http
      .post(
        `/api/notifications/${notification.id}/read`,
        {},
        this.tenantHeaders
      )
      .pipe(
        take(1),
        catchError(() => EMPTY)
      )
      .subscribe();
  }

  markAllRead(): void {
    const readAt = new Date().toISOString();
    this.items.update((items) =>
      items.map((n) => (n.readAt ? n : { ...n, readAt }))
    );
    this.unreadCount.set(0);
    this.http
      .post('/api/notifications/read-all', {}, this.tenantHeaders)
      .pipe(
        take(1),
        catchError(() => EMPTY)
      )
      .subscribe();
  }

  /** Clears one from the inbox right away in the UI; the server catches up. */
  dismiss(notification: NotificationModel): void {
    this.items.update((items) => items.filter((n) => n.id !== notification.id));
    if (!notification.readAt) {
      this.unreadCount.update((c) => Math.max(0, c - 1));
    }
    this.http
      .post(
        `/api/notifications/${notification.id}/dismiss`,
        {},
        this.tenantHeaders
      )
      .pipe(
        take(1),
        catchError(() => EMPTY)
      )
      .subscribe();
  }

  /** Clears the whole inbox for the active clinic. */
  dismissAll(): void {
    this.items.set([]);
    this.nextCursor.set(null);
    this.unreadCount.set(0);
    this.http
      .post('/api/notifications/dismiss-all', {}, this.tenantHeaders)
      .pipe(
        take(1),
        catchError(() => EMPTY)
      )
      .subscribe();
  }

  private fetchUnread(): Observable<NotificationUnreadCountResponse> {
    return this.http.get<NotificationUnreadCountResponse>(
      '/api/notifications/unread-count',
      this.tenantHeaders
    );
  }

  private fetchPage(cursor?: string): Observable<NotificationListResponse> {
    const params: Record<string, string> = { limit: String(PAGE_SIZE) };
    if (cursor) params['cursor'] = cursor;
    return this.http.get<NotificationListResponse>('/api/notifications', {
      ...this.tenantHeaders,
      params,
    });
  }

  private applyUnread(res: NotificationUnreadCountResponse): void {
    this.unreadCount.set(res.count);
    this.otherClinicUnread.set(
      Object.fromEntries(res.otherTenants.map((o) => [o.tenantId, o.count]))
    );
  }
}
