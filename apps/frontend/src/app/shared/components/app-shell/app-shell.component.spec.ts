import { TestBed, ComponentFixture } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';
import { AppShellComponent } from './app-shell.component';
import { AuthService } from '../../../core/services/auth.service';
import { TenantService } from '../../../core/services/tenant.service';

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
    selectClinic: vi.fn(),
    ...overrides,
  };
}

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let component: AppShellComponent;

  function setup(tenantOverrides: Record<string, unknown> = {}) {
    const tenantService = makeTenantService(tenantOverrides);

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

  it('shows clinic name from active membership', () => {
    setup();
    expect(component.clinicName()).toBe('Clinic A');
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
