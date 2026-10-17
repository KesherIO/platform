import { TestBed, ComponentFixture } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';
import { AppShellComponent } from './app-shell.component';
import { AuthService } from '../../../core/services/auth.service';
import { TenantService } from '../../../core/services/tenant.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PushSubscriptionService } from '../../../core/services/push-subscription.service';

function makeNotificationService(
  otherClinicUnread: Record<string, number> = {}
) {
  return {
    unreadCount: signal(0),
    otherClinicUnread: signal(otherClinicUnread),
    items: signal([]),
    nextCursor: signal(null),
    loading: signal(false),
    loadError: signal(false),
    startPolling: vi.fn(),
    refreshUnread: vi.fn(),
    loadFirstPage: vi.fn(),
    loadMore: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  };
}

function makeTenantService(overrides: Record<string, unknown> = {}) {
  const activeTenantId = signal('t1');
  const clinics = signal([
    {
      role: 'VET',
      status: 'ACTIVE',
      isOrderingVet: true,
      createdAt: '',
      tenant: {
        id: 't1',
        name: 'Clinic A',
        slug: 'clinic-a',
        logoUrl: null,
        primaryColor: null,
      },
    },
  ]);
  return {
    activeTenantId,
    clinics,
    activeMembership: computed(
      () => clinics().find((m) => m.tenant.id === activeTenantId()) ?? null
    ),
    hasMultipleClinics: computed(() => clinics().length > 1),
    labServicesSuspended: signal(false),
    selectClinic: vi.fn(),
    ...overrides,
  };
}

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let component: AppShellComponent;

  let notificationService: ReturnType<typeof makeNotificationService>;

  function setup(
    tenantOverrides: Record<string, unknown> = {},
    otherClinicUnread: Record<string, number> = {}
  ) {
    const tenantService = makeTenantService(tenantOverrides);
    notificationService = makeNotificationService(otherClinicUnread);

    TestBed.configureTestingModule({
      imports: [
        AppShellComponent,
        RouterModule.forRoot([]),
        TranslateModule.forRoot(),
      ],
      providers: [
        {
          provide: AuthService,
          useValue: {
            me: signal({
              user: {
                id: 'u1',
                email: 'test@test.com',
                firstName: 'Test',
                lastName: 'User',
                createdAt: '',
              },
              memberships: [],
              tenants: [],
              onboardingCompleted: true,
              activeTenantId: 't1',
            }),
            signOut: vi.fn().mockReturnValue(of(undefined)),
          },
        },
        { provide: TenantService, useValue: tenantService },
        { provide: NotificationService, useValue: notificationService },
        {
          provide: PushSubscriptionService,
          useValue: {
            permission: signal('unsupported'),
            subscribed: signal(false),
            enable: vi.fn(),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(AppShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    return tenantService;
  }

  it('creates without error', () => {
    setup();
    expect(component).toBeTruthy();
  });

  it('keeps unread counts polling for the session', () => {
    setup();
    expect(notificationService.startPolling).toHaveBeenCalledTimes(1);
  });

  it('has the notification bell', () => {
    setup();
    expect(
      fixture.nativeElement.querySelectorAll('app-notification-bell').length
    ).toBeGreaterThan(0);
  });

  it("shows another clinic's unread count in the switcher", () => {
    setup(
      {
        hasMultipleClinics: computed(() => true),
        clinics: signal([
          {
            role: 'VET',
            status: 'ACTIVE',
            isOrderingVet: true,
            createdAt: '',
            tenant: {
              id: 't1',
              name: 'Clinic A',
              slug: 'clinic-a',
              logoUrl: null,
              primaryColor: null,
            },
          },
          {
            role: 'VET',
            status: 'ACTIVE',
            isOrderingVet: true,
            createdAt: '',
            tenant: {
              id: 't2',
              name: 'Clinic B',
              slug: 'clinic-b',
              logoUrl: null,
              primaryColor: null,
            },
          },
        ]),
      },
      { t2: 3 }
    );

    expect(component.otherClinics()).toEqual([
      expect.objectContaining({ id: 't2', unread: 3 }),
    ]);
  });

  it('shows clinic name from active membership', () => {
    setup();
    expect(component.clinicName()).toBe('Clinic A');
  });

  it('"New case" is a normal link while lab services are active', () => {
    setup();
    const link = fixture.nativeElement.querySelector(
      'aside a[href="/cases/new"]'
    );
    expect(link?.getAttribute('aria-disabled')).toBeNull();
  });

  it('disables "New case" while the lab has suspended services', () => {
    setup({ labServicesSuspended: signal(true) });
    const link = fixture.nativeElement.querySelector(
      'aside a[href="/cases/new"]'
    );
    expect(link?.getAttribute('aria-disabled')).toBe('true');
    expect(link?.getAttribute('tabindex')).toBe('-1');
  });

  it('hides clinic switcher chevron for single clinic', () => {
    setup();
    const sidebar = fixture.nativeElement.querySelector('aside');
    const clinicButton = sidebar?.querySelector(
      '.relative button[type="button"]'
    );
    expect(clinicButton?.disabled).toBe(true);
  });

  it('shows clinic switcher chevron for multiple clinics', () => {
    setup({
      hasMultipleClinics: computed(() => true),
      clinics: signal([
        {
          role: 'VET',
          status: 'ACTIVE',
          isOrderingVet: true,
          createdAt: '',
          tenant: {
            id: 't1',
            name: 'Clinic A',
            slug: 'clinic-a',
            logoUrl: null,
            primaryColor: null,
          },
        },
        {
          role: 'ADMIN',
          status: 'ACTIVE',
          isOrderingVet: false,
          createdAt: '',
          tenant: {
            id: 't2',
            name: 'Clinic B',
            slug: 'clinic-b',
            logoUrl: null,
            primaryColor: null,
          },
        },
      ]),
    });

    const sidebar = fixture.nativeElement.querySelector('aside');
    const clinicButton = sidebar?.querySelector(
      '.relative button[type="button"]'
    );
    expect(clinicButton?.disabled).toBe(false);
  });

  it('calls switchClinic when selecting a different clinic', () => {
    const ts = setup({
      hasMultipleClinics: computed(() => true),
      clinics: signal([
        {
          role: 'VET',
          status: 'ACTIVE',
          isOrderingVet: true,
          createdAt: '',
          tenant: {
            id: 't1',
            name: 'Clinic A',
            slug: 'clinic-a',
            logoUrl: null,
            primaryColor: null,
          },
        },
        {
          role: 'ADMIN',
          status: 'ACTIVE',
          isOrderingVet: false,
          createdAt: '',
          tenant: {
            id: 't2',
            name: 'Clinic B',
            slug: 'clinic-b',
            logoUrl: null,
            primaryColor: null,
          },
        },
      ]),
    });

    component.switchClinic('t2');
    expect(ts.selectClinic).toHaveBeenCalledWith('t2');
  });
});
