import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClinicSettingsComponent } from './clinic-settings.component';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { TenantService } from '../../../core/services/tenant.service';
import { SettingsService } from '../../../core/services/settings.service';
import { of } from 'rxjs';
import { signal } from '@angular/core';

const MOCK_MEMBERSHIP_ADMIN = {
  tenant: {
    id: 't1',
    name: 'Vet Clinic',
    slug: 'vet-clinic',
    email: 'clinic@test.com',
    phone: '555-0001',
    address: '123 Main St',
    primaryContactName: 'Dr. Ana',
    city: 'Bogotá',
    country: 'CO',
    logoUrl: null,
    primaryColor: null,
  },
  role: 'ADMIN',
  status: 'ACTIVE',
  isOrderingVet: false,
  createdAt: '',
};

const MOCK_MEMBERSHIP_STAFF = {
  ...MOCK_MEMBERSHIP_ADMIN,
  role: 'VET',
};

const MOCK_ME_ADMIN = {
  user: { firstName: 'Karina', lastName: 'Martinez', email: 'k@test.com' },
  tenants: [MOCK_MEMBERSHIP_ADMIN.tenant],
  memberships: [MOCK_MEMBERSHIP_ADMIN],
  activeTenantId: 't1',
};

describe('ClinicSettingsComponent', () => {
  let fixture: ComponentFixture<ClinicSettingsComponent>;
  let component: ClinicSettingsComponent;
  let authService: {
    me: ReturnType<typeof signal>;
    loadMe: ReturnType<typeof vi.fn>;
  };
  let tenantService: { activeMembership: ReturnType<typeof signal> };
  let settingsService: { updateClinic: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authService = {
      me: signal(MOCK_ME_ADMIN),
      loadMe: vi.fn().mockReturnValue(of(MOCK_ME_ADMIN)),
    };
    tenantService = {
      activeMembership: signal(MOCK_MEMBERSHIP_ADMIN),
    };
    settingsService = {
      updateClinic: vi.fn().mockReturnValue(of(undefined)),
    };

    await TestBed.configureTestingModule({
      imports: [ClinicSettingsComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TenantService, useValue: tenantService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClinicSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('isAdmin is true for ADMIN role', () => {
    expect(component.isAdmin()).toBe(true);
  });

  it('isAdmin is false for non-admin role', () => {
    tenantService.activeMembership.set(MOCK_MEMBERSHIP_STAFF);
    expect(component.isAdmin()).toBe(false);
  });

  it('clinicName reads from me()', () => {
    expect(component.clinicName()).toBe('Vet Clinic');
  });

  it('startEditing populates edit signals from current values', () => {
    component.startEditing();
    expect(component.editName()).toBe('Vet Clinic');
    expect(component.editPhone()).toBe('555-0001');
    expect(component.editAddress()).toBe('123 Main St');
    expect(component.editing()).toBe(true);
  });

  it('cancelEditing sets editing to false', () => {
    component.startEditing();
    component.cancelEditing();
    expect(component.editing()).toBe(false);
  });

  it('save calls settingsService.updateClinic and auth.loadMe', () => {
    component.startEditing();
    authService.loadMe.mockClear(); // ignore the refresh done on open
    component.save();
    expect(settingsService.updateClinic).toHaveBeenCalledOnce();
    expect(authService.loadMe).toHaveBeenCalledOnce();
  });

  it('save sets editing to false on success', () => {
    component.startEditing();
    component.save();
    expect(component.editing()).toBe(false);
  });

  it('startEditing populates contact, city and country', () => {
    component.startEditing();
    expect(component.editContactName()).toBe('Dr. Ana');
    expect(component.editCity()).toBe('Bogotá');
    expect(component.editCountry()).toBe('CO');
  });

  it('save sends the full editable profile, with cleared fields as empty strings', () => {
    component.startEditing();
    component.editContactName.set('');
    component.editCity.set('Medellín');
    component.save();

    expect(settingsService.updateClinic).toHaveBeenCalledWith(
      {
        name: 'Vet Clinic',
        phone: '555-0001',
        address: '123 Main St',
        primaryContactName: '',
        city: 'Medellín',
        country: 'CO',
      },
      undefined
    );
  });

  it('reloads the clinic profile every time the screen opens', () => {
    expect(authService.loadMe).toHaveBeenCalledOnce();
  });

  it('shows changes made in the lab portal after reopening', () => {
    // Lab portal edited the shared profile; reopening reloads /auth/me.
    const labEdited = {
      ...MOCK_MEMBERSHIP_ADMIN,
      tenant: {
        ...MOCK_MEMBERSHIP_ADMIN.tenant,
        phone: '+57 310 999 8888',
        city: 'Cali',
        primaryContactName: 'Dr. Luis',
      },
    };
    authService.loadMe.mockImplementation(() => {
      tenantService.activeMembership.set(labEdited);
      return of(MOCK_ME_ADMIN);
    });

    fixture.destroy();
    fixture = TestBed.createComponent(ClinicSettingsComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('+57 310 999 8888');
    expect(text).toContain('Cali');
    expect(text).toContain('Dr. Luis');
  });

  it('clinicEmail reads from me()', () => {
    expect(component.clinicEmail()).toBe('clinic@test.com');
  });

  it('clinicEmail returns empty string when tenant has no email', () => {
    tenantService.activeMembership.set({
      ...MOCK_MEMBERSHIP_ADMIN,
      tenant: { ...MOCK_MEMBERSHIP_ADMIN.tenant, email: null },
    });
    expect(component.clinicEmail()).toBe('');
  });
});
