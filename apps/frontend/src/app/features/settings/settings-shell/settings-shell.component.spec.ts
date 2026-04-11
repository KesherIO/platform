import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsShellComponent } from './settings-shell.component';
import { TranslateModule } from '@ngx-translate/core';
import { Location } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { signal } from '@angular/core';
import { Component } from '@angular/core';

@Component({ selector: 'app-clinic-settings', standalone: true, template: '' })
class ClinicSettingsStub {}

@Component({ selector: 'app-staff-settings', standalone: true, template: '' })
class StaffSettingsStub {}

@Component({ selector: 'app-profile-settings', standalone: true, template: '' })
class ProfileSettingsStub {}

@Component({ selector: 'app-bottom-nav', standalone: true, template: '' })
class BottomNavStub {}

const MOCK_ME_ADMIN = {
  user: { firstName: 'Karina', lastName: 'Martinez', email: 'k@test.com' },
  tenants: [{ id: 't1' }],
  memberships: [{ tenant: { id: 't1' }, role: 'ADMIN' }],
  activeTenantId: 't1',
};

const MOCK_ME_STAFF = {
  user: { firstName: 'Juan', lastName: 'López', email: 'j@test.com' },
  tenants: [{ id: 't1' }],
  memberships: [{ tenant: { id: 't1' }, role: 'VET' }],
  activeTenantId: 't1',
};

describe('SettingsShellComponent', () => {
  let fixture: ComponentFixture<SettingsShellComponent>;
  let component: SettingsShellComponent;
  let authService: { me: ReturnType<typeof signal> };
  let locationSpy: { back: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authService = { me: signal(MOCK_ME_ADMIN) };
    locationSpy = { back: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SettingsShellComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Location, useValue: locationSpy },
      ],
    })
      .overrideComponent(SettingsShellComponent, {
        set: {
          imports: [
            TranslateModule,
            ClinicSettingsStub,
            StaffSettingsStub,
            ProfileSettingsStub,
            BottomNavStub,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SettingsShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('isAdmin is true for ADMIN role', () => {
    expect(component.isAdmin()).toBe(true);
  });

  it('isAdmin is true for OWNER role', () => {
    authService.me.set({
      ...MOCK_ME_ADMIN,
      memberships: [{ tenant: { id: 't1' }, role: 'OWNER' }],
    });
    expect(component.isAdmin()).toBe(true);
  });

  it('isAdmin is false for non-admin role', () => {
    authService.me.set(MOCK_ME_STAFF);
    expect(component.isAdmin()).toBe(false);
  });

  it('isAdmin is false when not logged in', () => {
    authService.me.set(null);
    expect(component.isAdmin()).toBe(false);
  });

  it('tabs includes staff tab for admin', () => {
    expect(component.tabs().map((t) => t.key)).toContain('staff');
  });

  it('tabs does not include staff tab for non-admin', () => {
    authService.me.set(MOCK_ME_STAFF);
    expect(component.tabs().map((t) => t.key)).not.toContain('staff');
  });

  it('tabs always includes clinic and profile', () => {
    const keys = component.tabs().map((t) => t.key);
    expect(keys).toContain('clinic');
    expect(keys).toContain('profile');
  });

  it('activeTab defaults to clinic', () => {
    expect(component.activeTab()).toBe('clinic');
  });

  it('activeTab updates when set', () => {
    component.activeTab.set('profile');
    expect(component.activeTab()).toBe('profile');
  });

  it('goBack calls location.back()', () => {
    component.goBack();
    expect(locationSpy.back).toHaveBeenCalledOnce();
  });
});
