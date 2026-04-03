import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { AdminProfileComponent } from './admin-profile.component';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { AuthService } from '../../../core/services/auth.service';
import { provideTranslateService } from '@ngx-translate/core';
import { OnboardingState } from '../../../core/models';

function makeState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { tenantId: 'tenant-abc', step: 'admin-profile', isFirstUser: true, ...overrides };
}

const CLINIC_STUB = {
  name: 'City Vet',
  address: '123 Main St',
  city: 'Austin',
  email: 'info@cityvet.com',
  telephone: '555-0100',
  notificationMethod: 'email' as const,
};

describe('AdminProfileComponent', () => {
  let component: AdminProfileComponent;
  let fixture: ComponentFixture<AdminProfileComponent>;
  let onboardingStateSignal: ReturnType<typeof signal<OnboardingState>>;
  let mockOnboardingService: {
    getOnboardingState: ReturnType<typeof vi.fn>;
    completeAdminOnboarding: ReturnType<typeof vi.fn>;
    storeAdminProfileDraft: ReturnType<typeof vi.fn>;
  };
  let mockAuthService: {
    isLoggedIn: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
  };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };

  async function setup(stateOverrides: Partial<OnboardingState> = {}) {
    onboardingStateSignal = signal(makeState(stateOverrides));
    mockOnboardingService = {
      getOnboardingState: vi.fn().mockReturnValue(onboardingStateSignal.asReadonly()),
      completeAdminOnboarding: vi.fn(),
      storeAdminProfileDraft: vi.fn(),
    };
    mockAuthService = {
      isLoggedIn: vi.fn().mockReturnValue(false),
      signOut: vi.fn().mockReturnValue(of(undefined)),
    };
    mockRouter = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [AdminProfileComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: OnboardingService, useValue: mockOnboardingService },
        { provide: AuthService,       useValue: mockAuthService       },
        { provide: Router,            useValue: mockRouter            },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('should create', async () => {
    await setup();
    expect(component).toBeTruthy();
  });

  describe('profileForm', () => {
    beforeEach(async () => setup());

    it('has the required controls', () => {
      expect(component.profileForm.contains('firstName')).toBe(true);
      expect(component.profileForm.contains('lastName')).toBe(true);
      expect(component.profileForm.contains('email')).toBe(true);
      expect(component.profileForm.contains('password')).toBe(true);
      expect(component.profileForm.contains('confirmPassword')).toBe(true);
    });

    it('is invalid when empty', () => {
      expect(component.profileForm.valid).toBe(false);
    });

    it('is valid when all required fields are filled correctly', () => {
      component.profileForm.patchValue({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });
      expect(component.profileForm.valid).toBe(true);
    });

    it('detects password mismatch', () => {
      component.profileForm.patchValue({
        firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
        password: 'password123', confirmPassword: 'different',
      });
      component.profileForm.get('confirmPassword')!.markAsDirty();
      expect(component.passwordMismatch).toBe(true);
    });
  });

  describe('onSave()', () => {
    beforeEach(async () => setup());

    it('does nothing when form is invalid', () => {
      component.onSave();
      expect(mockOnboardingService.completeAdminOnboarding).not.toHaveBeenCalled();
    });

    it('sets error when no onboarding token in state', () => {
      // default state has no onboardingToken
      component.profileForm.patchValue({
        firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
        password: 'password123', confirmPassword: 'password123',
      });

      component.onSave();

      expect(component.error()).toContain('token');
      expect(mockOnboardingService.completeAdminOnboarding).not.toHaveBeenCalled();
    });

    it('sets error when clinic data is missing from state', () => {
      onboardingStateSignal.update((s) => ({
        ...s,
        onboardingToken: 'hex-token',
        clinic: undefined,
      }));

      component.profileForm.patchValue({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });

      component.onSave();

      expect(component.error()).toContain('Clinic setup');
      expect(mockOnboardingService.completeAdminOnboarding).not.toHaveBeenCalled();
    });

    it('calls completeAdminOnboarding and sets completed on success', () => {
      onboardingStateSignal.update((s) => ({
        ...s,
        onboardingToken: 'hex-token',
        clinic: CLINIC_STUB,
      }));
      mockOnboardingService.completeAdminOnboarding.mockReturnValue(
        of({ tenantId: 't1', userId: 'u1' })
      );

      component.profileForm.patchValue({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });

      component.onSave();

      expect(mockOnboardingService.completeAdminOnboarding).toHaveBeenCalled();
      expect(component.completed()).toBe(true);
      expect(component.loading()).toBe(false);
    });

    it('sets logoUploadWarning when server signals a failed logo upload', () => {
      onboardingStateSignal.update((s) => ({
        ...s,
        onboardingToken: 'hex-token',
        clinic: CLINIC_STUB,
      }));
      mockOnboardingService.completeAdminOnboarding.mockReturnValue(
        of({ tenantId: 't1', userId: 'u1', logoUploadFailed: true, message: 'Logo failed' })
      );

      component.profileForm.patchValue({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });

      component.onSave();

      expect(component.logoUploadWarning()).toBe('Logo failed');
      expect(component.completed()).toBe(true);
    });

    it('sets error and clears loading on failure', () => {
      onboardingStateSignal.update((s) => ({
        ...s,
        onboardingToken: 'hex-token',
        clinic: CLINIC_STUB,
      }));
      mockOnboardingService.completeAdminOnboarding.mockReturnValue(
        throwError(() => ({ message: 'Server error' }))
      );

      component.profileForm.patchValue({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });

      component.onSave();

      expect(component.error()).toBe('Server error');
      expect(component.loading()).toBe(false);
    });

    it('calls completeAdminOnboarding and sets completed on success', () => {
      onboardingStateSignal.update((s) => ({
        ...s,
        onboardingToken: 'hex-token',
        clinic: CLINIC_STUB,
      }));
      mockOnboardingService.completeAdminOnboarding.mockReturnValue(
        of({ tenantId: 't1', userId: 'u1' })
      );

      component.profileForm.patchValue({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });

      component.onSave();

      expect(mockOnboardingService.completeAdminOnboarding).toHaveBeenCalled();
      expect(component.completed()).toBe(true);
      expect(component.loading()).toBe(false);
    });

    it('sets logoUploadWarning when server signals a failed logo upload', () => {
      onboardingStateSignal.update((s) => ({
        ...s,
        onboardingToken: 'hex-token',
        clinic: CLINIC_STUB,
      }));
      mockOnboardingService.completeAdminOnboarding.mockReturnValue(
        of({ tenantId: 't1', userId: 'u1', logoUploadFailed: true, message: 'Logo failed' })
      );

      component.profileForm.patchValue({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });

      component.onSave();

      expect(component.logoUploadWarning()).toBe('Logo failed');
      expect(component.completed()).toBe(true);
    });

    it('sets error and clears loading on failure', () => {
      onboardingStateSignal.update((s) => ({
        ...s,
        onboardingToken: 'hex-token',
        clinic: CLINIC_STUB,
      }));
      mockOnboardingService.completeAdminOnboarding.mockReturnValue(
        throwError(() => ({ message: 'Server error' }))
      );

      component.profileForm.patchValue({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });

      component.onSave();

      expect(component.error()).toBe('Server error');
      expect(component.loading()).toBe(false);
    });
  });

  describe('onBack()', () => {
    it('saves a draft and navigates to clinic-setup', async () => {
      await setup();
      component.onBack();
      expect(mockOnboardingService.storeAdminProfileDraft).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/onboarding/clinic-setup']);
    });
  });

  describe('onGoToSignIn()', () => {
    it('navigates to /auth/login when not logged in', async () => {
      await setup();
      mockAuthService.isLoggedIn.mockReturnValue(false);
      component.onGoToSignIn();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('signs out then navigates when already logged in', async () => {
      await setup();
      mockAuthService.isLoggedIn.mockReturnValue(true);
      mockAuthService.signOut.mockReturnValue(of(undefined));
      component.onGoToSignIn();
      expect(mockAuthService.signOut).toHaveBeenCalled();
    });
  });
});
