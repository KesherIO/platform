import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import type { NotificationModel } from '@vet-ai/shared-types';
import { NotificationBellComponent } from './notification-bell.component';
import { NotificationService } from '../../../core/services/notification.service';
import { PushSubscriptionService } from '../../../core/services/push-subscription.service';

const notification = (
  overrides: Partial<NotificationModel> = {}
): NotificationModel => ({
  id: 'n-1',
  type: 'RESULTS_RELEASED',
  tenantId: 't1',
  orderId: 'o-1',
  params: { requisitionNumber: 'REQ-1', caseId: 'c-1', releaseType: 'FINAL' },
  patientName: 'Firulais',
  link: '/cases/c-1/report?clinic=t1',
  createdAt: '2026-10-18T10:00:00.000Z',
  ...overrides,
});

function makeNotifications(unread: number, items: NotificationModel[]) {
  return {
    unreadCount: signal(unread),
    items: signal(items),
    nextCursor: signal<string | null>(null),
    loading: signal(false),
    loadError: signal(false),
    loadFirstPage: vi.fn(),
    refreshUnread: vi.fn(),
    loadMore: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  };
}

function makePush() {
  return {
    permission: signal('default'),
    subscribed: signal(false),
    enable: vi.fn().mockReturnValue(of(undefined)),
  };
}

describe('NotificationBellComponent', () => {
  let fixture: ComponentFixture<NotificationBellComponent>;
  let component: NotificationBellComponent;
  let notifications: ReturnType<typeof makeNotifications>;
  let push: ReturnType<typeof makePush>;
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };

  function setup(unread = 2, items: NotificationModel[] = [notification()]) {
    notifications = makeNotifications(unread, items);
    push = makePush();
    router = { navigateByUrl: vi.fn() };
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent, TranslateModule.forRoot()],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: PushSubscriptionService, useValue: push },
        { provide: Router, useValue: router },
      ],
    });
    fixture = TestBed.createComponent(NotificationBellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const openPanel = () => {
    (el().querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('creates without error and shows the unread count', () => {
    setup();
    expect(component).toBeTruthy();
    expect(el().textContent).toContain('2');
    expect(el().querySelector('[role="dialog"]')).toBeNull();
  });

  it('opening loads the inbox', () => {
    setup();
    openPanel();

    expect(notifications.loadFirstPage).toHaveBeenCalled();
    expect(el().querySelector('[role="dialog"]')).toBeTruthy();
    expect(el().textContent).toContain(
      'NOTIFICATIONS.TYPES.RESULTS_RELEASED_FINAL'
    );
    expect(el().textContent).toContain('Firulais');
  });

  it('opening a notification marks it read and follows its link', () => {
    setup();
    openPanel();

    component.openNotification(notifications.items()[0]);

    expect(notifications.markRead).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n-1' })
    );
    expect(router.navigateByUrl).toHaveBeenCalledWith(
      '/cases/c-1/report?clinic=t1'
    );
    expect(component.open()).toBe(false);
  });

  it('describes each type', () => {
    setup();
    expect(
      component.describe(notification({ type: 'TESTS_ADDED', params: {} })).key
    ).toBe('NOTIFICATIONS.TYPES.TESTS_ADDED');
    expect(
      component.describe(
        notification({ type: 'ADDITIONAL_SAMPLE_REQUIRED', params: {} })
      ).key
    ).toBe('NOTIFICATIONS.TYPES.ADDITIONAL_SAMPLE_REQUIRED');
    expect(
      component.describe(
        notification({
          params: { releaseType: 'PARTIAL', requisitionNumber: 'R' },
        })
      )
    ).toEqual({
      key: 'NOTIFICATIONS.TYPES.RESULTS_RELEASED_PARTIAL',
      params: { req: 'R' },
    });
    expect(
      component.describe(notification({ type: 'RESULTS_AMENDED' })).key
    ).toBe('NOTIFICATIONS.TYPES.RESULTS_AMENDED');
  });

  it('clears one notification, or all of them', () => {
    setup();
    openPanel();

    (
      el().querySelector(
        'button[aria-label="NOTIFICATIONS.CLEAR"]'
      ) as HTMLButtonElement
    ).click();
    expect(notifications.dismiss).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n-1' })
    );
    // Clearing doesn't open the notification
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    const clearAll = Array.from(el().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'NOTIFICATIONS.CLEAR_ALL'
    ) as HTMLButtonElement;
    clearAll.click();
    expect(notifications.dismissAll).toHaveBeenCalled();
  });

  it('shows the empty state', () => {
    setup(0, []);
    openPanel();
    expect(el().textContent).toContain('NOTIFICATIONS.EMPTY');
  });

  it('offers browser notifications and reports a failure', () => {
    setup();
    openPanel();
    expect(el().textContent).toContain('NOTIFICATIONS.ENABLE_PUSH');

    push.enable.mockReturnValue(throwError(() => new Error('denied')));
    component.enablePush();
    fixture.detectChanges();

    expect(component.pushError()).toBe(true);
    expect(el().textContent).toContain('NOTIFICATIONS.PUSH_ERROR');
  });

  it('closes on Escape', () => {
    setup();
    openPanel();
    component.close();
    expect(component.open()).toBe(false);
  });
});
