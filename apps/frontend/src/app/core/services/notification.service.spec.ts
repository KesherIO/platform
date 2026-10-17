import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import type { NotificationModel } from '@vet-ai/shared-types';
import { NotificationService } from './notification.service';
import { TenantService } from './tenant.service';

const notification = (
  overrides: Partial<NotificationModel> = {}
): NotificationModel => ({
  id: 'n-1',
  type: 'RESULTS_RELEASED',
  tenantId: 't1',
  orderId: 'o-1',
  params: { requisitionNumber: 'REQ-1', caseId: 'c-1', releaseType: 'FINAL' },
  link: '/cases/c-1/report?clinic=t1',
  createdAt: '2026-10-18T10:00:00.000Z',
  ...overrides,
});

describe('NotificationService', () => {
  let service: NotificationService;
  let httpMock: HttpTestingController;
  let cacheCleaner: () => void;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: TenantService,
          useValue: {
            activeTenantId: signal('t1'),
            registerCacheCleaner: vi.fn(
              (fn: () => void) => (cacheCleaner = fn)
            ),
          },
        },
      ],
    });
    service = TestBed.inject(NotificationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('creates without error', () => {
    expect(service).toBeTruthy();
  });

  it('refreshUnread stores the count and other clinics’ counts', () => {
    service.refreshUnread();

    const req = httpMock.expectOne('/api/notifications/unread-count');
    expect(req.request.headers.get('x-tenant-id')).toBe('t1');
    req.flush({ count: 2, otherTenants: [{ tenantId: 't2', count: 5 }] });

    expect(service.unreadCount()).toBe(2);
    expect(service.otherClinicUnread()).toEqual({ t2: 5 });
  });

  it('loads the first page, then more with the cursor', () => {
    service.loadFirstPage();
    httpMock
      .expectOne(
        (r) => r.url === '/api/notifications' && !r.params.has('cursor')
      )
      .flush({ items: [notification()], nextCursor: 'n-1' });

    expect(service.items()).toHaveLength(1);
    expect(service.nextCursor()).toBe('n-1');

    service.loadMore();
    const more = httpMock.expectOne(
      (r) => r.url === '/api/notifications' && r.params.get('cursor') === 'n-1'
    );
    more.flush({ items: [notification({ id: 'n-0' })], nextCursor: null });

    expect(service.items().map((n) => n.id)).toEqual(['n-1', 'n-0']);
    expect(service.nextCursor()).toBeNull();
  });

  it('flags a load error', () => {
    service.loadFirstPage();
    httpMock
      .expectOne((r) => r.url === '/api/notifications')
      .flush('x', { status: 500, statusText: 'Server Error' });

    expect(service.loadError()).toBe(true);
    expect(service.loading()).toBe(false);
  });

  it('markRead updates the UI at once and tells the API', () => {
    service.unreadCount.set(2);
    service.items.set([notification()]);

    service.markRead(service.items()[0]);

    expect(service.items()[0].readAt).toBeTruthy();
    expect(service.unreadCount()).toBe(1);
    const req = httpMock.expectOne('/api/notifications/n-1/read');
    expect(req.request.method).toBe('POST');
    req.flush({ read: true });
  });

  it('markRead skips one already read', () => {
    service.markRead(notification({ readAt: '2026-10-18T11:00:00.000Z' }));
    httpMock.expectNone('/api/notifications/n-1/read');
  });

  it('markAllRead clears the count', () => {
    service.unreadCount.set(3);
    service.items.set([notification(), notification({ id: 'n-2' })]);

    service.markAllRead();

    expect(service.unreadCount()).toBe(0);
    expect(service.items().every((n) => n.readAt)).toBe(true);
    httpMock.expectOne('/api/notifications/read-all').flush({ updated: 2 });
  });

  it('dismiss removes one from the inbox at once and tells the API', () => {
    service.unreadCount.set(2);
    service.items.set([notification(), notification({ id: 'n-2' })]);

    service.dismiss(service.items()[0]);

    expect(service.items().map((n) => n.id)).toEqual(['n-2']);
    expect(service.unreadCount()).toBe(1);
    const req = httpMock.expectOne('/api/notifications/n-1/dismiss');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('x-tenant-id')).toBe('t1');
    req.flush({ dismissed: true });
  });

  it('dismissing a read one leaves the unread count alone', () => {
    service.unreadCount.set(1);
    const read = notification({ readAt: '2026-10-18T11:00:00.000Z' });
    service.items.set([read]);

    service.dismiss(read);

    expect(service.unreadCount()).toBe(1);
    httpMock.expectOne('/api/notifications/n-1/dismiss').flush({});
  });

  it('dismissAll empties the inbox', () => {
    service.unreadCount.set(3);
    service.items.set([notification(), notification({ id: 'n-2' })]);
    service.nextCursor.set('n-2');

    service.dismissAll();

    expect(service.items()).toEqual([]);
    expect(service.nextCursor()).toBeNull();
    expect(service.unreadCount()).toBe(0);
    httpMock
      .expectOne('/api/notifications/dismiss-all')
      .flush({ dismissed: 2 });
  });

  it('switching clinic empties the inbox and refetches the count', () => {
    service.items.set([notification()]);
    service.unreadCount.set(4);

    cacheCleaner();

    expect(service.items()).toEqual([]);
    httpMock
      .expectOne('/api/notifications/unread-count')
      .flush({ count: 0, otherTenants: [] });
    expect(service.unreadCount()).toBe(0);
  });
});
