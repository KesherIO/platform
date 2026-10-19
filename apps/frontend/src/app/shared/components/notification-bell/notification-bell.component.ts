import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import type { NotificationModel } from '@vet-ai/shared-types';
import { NotificationService } from '../../../core/services/notification.service';
import { PushSubscriptionService } from '../../../core/services/push-subscription.service';

/**
 * Bell with the unread count for the active clinic, and a panel to read and
 * open notifications (and turn on browser notifications for this device).
 */
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [TranslatePipe, DatePipe],
  templateUrl: './notification-bell.component.html',
  styleUrl: './notification-bell.component.scss',
})
export class NotificationBellComponent {
  readonly notifications = inject(NotificationService);
  readonly push = inject(PushSubscriptionService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  /** Which edge the panel lines up with */
  readonly align = input<'left' | 'right'>('right');

  readonly open = signal(false);
  readonly pushError = signal(false);
  readonly enablingPush = signal(false);

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.notifications.loadFirstPage();
      this.notifications.refreshUnread();
    }
  }

  openNotification(n: NotificationModel): void {
    this.open.set(false);
    this.notifications.markRead(n);
    this.router.navigateByUrl(n.link);
  }

  enablePush(): void {
    this.enablingPush.set(true);
    this.pushError.set(false);
    this.push
      .enable()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.enablingPush.set(false),
        error: () => {
          this.enablingPush.set(false);
          this.pushError.set(true);
        },
      });
  }

  /** Translation key and params for one notification's text. */
  describe(n: NotificationModel): {
    key: string;
    params: Record<string, string>;
  } {
    const params = { req: n.params.requisitionNumber ?? '' };
    switch (n.type) {
      case 'RESULTS_RELEASED':
        return {
          key:
            n.params.releaseType === 'FINAL'
              ? 'NOTIFICATIONS.TYPES.RESULTS_RELEASED_FINAL'
              : 'NOTIFICATIONS.TYPES.RESULTS_RELEASED_PARTIAL',
          params,
        };
      default:
        return { key: `NOTIFICATIONS.TYPES.${n.type}`, params };
    }
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.open.set(false);
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: Event): void {
    if (
      this.open() &&
      !this.host.nativeElement.contains(event.target as Node)
    ) {
      this.open.set(false);
    }
  }
}
