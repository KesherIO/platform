import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsShellComponent } from './settings-shell.component';
import { TranslateModule } from '@ngx-translate/core';
import { Location } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { Component } from '@angular/core';

// Stub out StaffSettingsComponent to avoid pulling in its dependencies
@Component({ selector: 'app-staff-settings', standalone: true, template: '' })
class StaffSettingsStub {}

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
  let authService: {
    me: ReturnType<typeof signal>;
    signOut: ReturnType<typeof vi.fn>;
  };
  let locationSpy: { back: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authService = {
      me: signal(MOCK_ME_ADMIN),
      signOut: vi.fn().mockReturnValue(of(null)),
    };
    locationSpy = { back: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SettingsShellComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Location, useValue: locationSpy },
      ],
    })
      .overrideComponent(SettingsShellComponent, {
        remove: { imports: [StaffSettingsStub] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SettingsShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Creation ──────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ── isAdmin ───────────────────────────────────────────────────────────────

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

  it('isAdmin falls back to first tenant when activeTenantId is null', () => {
    authService.me.set({ ...MOCK_ME_ADMIN, activeTenantId: null });
    expect(component.isAdmin()).toBe(true);
  });

  // ── tabs ──────────────────────────────────────────────────────────────────

  it('tabs includes staff tab for admin', () => {
    const keys = component.tabs().map((t) => t.key);
    expect(keys).toContain('staff');
  });

  it('tabs does not include staff tab for non-admin', () => {
    authService.me.set(MOCK_ME_STAFF);
    const keys = component.tabs().map((t) => t.key);
    expect(keys).not.toContain('staff');
  });

  it('tabs always includes clinic and profile', () => {
    const keys = component.tabs().map((t) => t.key);
    expect(keys).toContain('clinic');
    expect(keys).toContain('profile');
  });

  // ── activeTab ─────────────────────────────────────────────────────────────

  it('activeTab defaults to clinic', () => {
    expect(component.activeTab()).toBe('clinic');
  });

  it('activeTab updates when set', () => {
    component.activeTab.set('profile');
    expect(component.activeTab()).toBe('profile');
  });

  // ── userDisplayName ───────────────────────────────────────────────────────

  it('userDisplayName returns full name', () => {
    expect(component.userDisplayName()).toBe('Karina Martinez');
  });

  it('userDisplayName returns email when no first name', () => {
    authService.me.set({ ...MOCK_ME_ADMIN, user: { email: 'k@test.com' } });
    expect(component.userDisplayName()).toBe('k@test.com');
  });

  it('userDisplayName returns empty string when not logged in', () => {
    authService.me.set(null);
    expect(component.userDisplayName()).toBe('');
  });

  // ── userEmail ─────────────────────────────────────────────────────────────

  it('userEmail returns the logged-in user email', () => {
    expect(component.userEmail()).toBe('k@test.com');
  });

  it('userEmail returns empty string when not logged in', () => {
    authService.me.set(null);
    expect(component.userEmail()).toBe('');
  });

  // ── goBack ────────────────────────────────────────────────────────────────

  it('goBack calls location.back()', () => {
    component.goBack();
    expect(locationSpy.back).toHaveBeenCalledOnce();
  });

  // ── signOut ───────────────────────────────────────────────────────────────

  it('signOut calls auth.signOut', () => {
    component.signOut();
    expect(authService.signOut).toHaveBeenCalledOnce();
  });

  it('signOut sets signingOut to true while in progress', () => {
    authService.signOut.mockReturnValue(of(null));
    component.signOut();
    // signingOut starts true; after observable completes it stays true (no reset on success)
    expect(component.signingOut()).toBe(true);
  });

  it('signOut resets signingOut on error', () => {
    authService.signOut.mockReturnValue(throwError(() => new Error('fail')));
    component.signOut();
    expect(component.signingOut()).toBe(false);
  });
});
