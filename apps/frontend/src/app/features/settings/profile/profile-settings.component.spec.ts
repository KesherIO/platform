import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfileSettingsComponent } from './profile-settings.component';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';

const MOCK_ME = {
  user: {
    firstName: 'Karina',
    lastName: 'Martinez',
    email: 'k@test.com',
    phone: null,
  },
  tenants: [{ id: 't1' }],
  memberships: [{ tenant: { id: 't1' }, role: 'ADMIN' }],
  activeTenantId: 't1',
};

describe('ProfileSettingsComponent', () => {
  let fixture: ComponentFixture<ProfileSettingsComponent>;
  let component: ProfileSettingsComponent;
  let authService: {
    me: ReturnType<typeof signal>;
    updateProfile: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
  };
  let langService: {
    currentLang: ReturnType<typeof signal>;
    setLanguage: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authService = {
      me: signal(MOCK_ME),
      updateProfile: vi.fn().mockReturnValue(of(undefined)),
      signOut: vi.fn().mockReturnValue(of(null)),
    };
    langService = {
      currentLang: signal('en' as 'en' | 'es'),
      setLanguage: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ProfileSettingsComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: LanguageService, useValue: langService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('userDisplayName returns full name', () => {
    expect(component.userDisplayName()).toBe('Karina Martinez');
  });

  it('userDisplayName falls back to email when no first name', () => {
    authService.me.set({ ...MOCK_ME, user: { email: 'k@test.com' } });
    expect(component.userDisplayName()).toBe('k@test.com');
  });

  it('userEmail returns the logged-in user email', () => {
    expect(component.userEmail()).toBe('k@test.com');
  });

  it('startEditing populates edit signals', () => {
    component.startEditing();
    expect(component.editFirstName()).toBe('Karina');
    expect(component.editLastName()).toBe('Martinez');
    expect(component.editing()).toBe(true);
  });

  it('cancelEditing sets editing to false', () => {
    component.startEditing();
    component.cancelEditing();
    expect(component.editing()).toBe(false);
  });

  it('save calls auth.updateProfile and closes edit mode on success', () => {
    component.startEditing();
    component.save();
    expect(authService.updateProfile).toHaveBeenCalledOnce();
    expect(component.editing()).toBe(false);
  });

  it('save resets saving on error', () => {
    authService.updateProfile.mockReturnValue(
      throwError(() => new Error('fail'))
    );
    component.startEditing();
    component.save();
    expect(component.saving()).toBe(false);
  });

  it('signOut calls auth.signOut', () => {
    component.signOut();
    expect(authService.signOut).toHaveBeenCalledOnce();
  });

  it('signOut resets signingOut on error', () => {
    authService.signOut.mockReturnValue(throwError(() => new Error('fail')));
    component.signOut();
    expect(component.signingOut()).toBe(false);
  });

  it('setLanguage delegates to langService', () => {
    component.setLanguage('es');
    expect(langService.setLanguage).toHaveBeenCalledWith('es');
  });
});
