import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClinicSettingsComponent } from './clinic-settings.component';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { of } from 'rxjs';
import { signal } from '@angular/core';

const MOCK_ME_ADMIN = {
  user: { firstName: 'Karina', lastName: 'Martinez', email: 'k@test.com' },
  tenants: [
    {
      id: 't1',
      name: 'Vet Clinic',
      email: 'clinic@test.com',
      phone: '555-0001',
      address: '123 Main St',
      logoUrl: null,
    },
  ],
  memberships: [{ tenant: { id: 't1' }, role: 'ADMIN' }],
  activeTenantId: 't1',
};

const MOCK_ME_STAFF = {
  ...MOCK_ME_ADMIN,
  memberships: [{ tenant: { id: 't1' }, role: 'VET' }],
};

describe('ClinicSettingsComponent', () => {
  let fixture: ComponentFixture<ClinicSettingsComponent>;
  let component: ClinicSettingsComponent;
  let authService: {
    me: ReturnType<typeof signal>;
    loadMe: ReturnType<typeof vi.fn>;
  };
  let settingsService: { updateClinic: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authService = {
      me: signal(MOCK_ME_ADMIN),
      loadMe: vi.fn().mockReturnValue(of(MOCK_ME_ADMIN)),
    };
    settingsService = {
      updateClinic: vi.fn().mockReturnValue(of(undefined)),
    };

    await TestBed.configureTestingModule({
      imports: [ClinicSettingsComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: authService },
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
    authService.me.set(MOCK_ME_STAFF);
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
    component.save();
    expect(settingsService.updateClinic).toHaveBeenCalledOnce();
    expect(authService.loadMe).toHaveBeenCalledOnce();
  });

  it('save sets editing to false on success', () => {
    component.startEditing();
    component.save();
    expect(component.editing()).toBe(false);
  });

  it('clinicEmail reads from me()', () => {
    expect(component.clinicEmail()).toBe('clinic@test.com');
  });

  it('clinicEmail returns empty string when tenant has no email', () => {
    authService.me.set({
      ...MOCK_ME_ADMIN,
      tenants: [{ ...MOCK_ME_ADMIN.tenants[0], email: null }],
    });
    expect(component.clinicEmail()).toBe('');
  });
});
