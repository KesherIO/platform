import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { StaffProfileComponent } from './staff-profile.component';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { provideTranslateService } from '@ngx-translate/core';

describe('StaffProfileComponent', () => {
  let component: StaffProfileComponent;
  let fixture: ComponentFixture<StaffProfileComponent>;
  let mockOnboardingService: {
    verifyMagicLink: ReturnType<typeof vi.fn>;
    completeStaffOnboarding: ReturnType<typeof vi.fn>;
  };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };

  function makeVerifyResponse(overrides = {}) {
    return {
      tenantId: 'tenant-abc',
      tenantName: 'City Vet',
      email: 'staff@example.com',
      role: 'staff' as const,
      userExists: false,
      ...overrides,
    };
  }

  async function setup(token: string | null = null) {
    mockOnboardingService = {
      verifyMagicLink: vi.fn(),
      completeStaffOnboarding: vi.fn(),
    };
    mockRouter = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [StaffProfileComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: OnboardingService, useValue: mockOnboardingService },
        { provide: Router,            useValue: mockRouter            },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: { get: (key: string) => key === 'token' ? token : null },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StaffProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('should create', async () => {
    await setup();
    expect(component).toBeTruthy();
  });

  describe('ngOnInit — no token', () => {
    it('sets view to error when no token is in the URL', async () => {
      await setup(null);
      expect(component.view()).toBe('error');
    });

    it('does not call verifyMagicLink when no token', async () => {
      await setup(null);
      expect(mockOnboardingService.verifyMagicLink).not.toHaveBeenCalled();
    });
  });

  describe('ngOnInit — with token', () => {
    it('sets view to new-user when userExists is false', async () => {
      mockOnboardingService.verifyMagicLink.mockReturnValue(of(makeVerifyResponse({ userExists: false })));
      // Need to setup before detectChanges — use TestBed directly
      mockRouter = { navigate: vi.fn() };
      await TestBed.configureTestingModule({
        imports: [StaffProfileComponent],
        providers: [
          provideTranslateService({ defaultLanguage: 'en' }),
          { provide: OnboardingService, useValue: mockOnboardingService },
          { provide: Router,            useValue: mockRouter            },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => 'invite-token' } } } },
        ],
      }).compileComponents();
      const f = TestBed.createComponent(StaffProfileComponent);
      f.detectChanges();
      expect(f.componentInstance.view()).toBe('new-user');
    });

    it('sets view to existing-user when userExists is true', async () => {
      mockOnboardingService.verifyMagicLink.mockReturnValue(of(makeVerifyResponse({ userExists: true })));
      mockRouter = { navigate: vi.fn() };
      await TestBed.configureTestingModule({
        imports: [StaffProfileComponent],
        providers: [
          provideTranslateService({ defaultLanguage: 'en' }),
          { provide: OnboardingService, useValue: mockOnboardingService },
          { provide: Router,            useValue: mockRouter            },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => 'invite-token' } } } },
        ],
      }).compileComponents();
      const f = TestBed.createComponent(StaffProfileComponent);
      f.detectChanges();
      expect(f.componentInstance.view()).toBe('existing-user');
    });

    it('sets view to error when verifyMagicLink throws', async () => {
      mockOnboardingService.verifyMagicLink.mockReturnValue(throwError(() => new Error('Invalid token')));
      mockRouter = { navigate: vi.fn() };
      await TestBed.configureTestingModule({
        imports: [StaffProfileComponent],
        providers: [
          provideTranslateService({ defaultLanguage: 'en' }),
          { provide: OnboardingService, useValue: mockOnboardingService },
          { provide: Router,            useValue: mockRouter            },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => 'invite-token' } } } },
        ],
      }).compileComponents();
      const f = TestBed.createComponent(StaffProfileComponent);
      f.detectChanges();
      expect(f.componentInstance.view()).toBe('error');
    });

    it('sets tenantName from the verify response', async () => {
      mockOnboardingService.verifyMagicLink.mockReturnValue(
        of(makeVerifyResponse({ tenantName: 'City Vet' }))
      );
      mockRouter = { navigate: vi.fn() };
      await TestBed.configureTestingModule({
        imports: [StaffProfileComponent],
        providers: [
          provideTranslateService({ defaultLanguage: 'en' }),
          { provide: OnboardingService, useValue: mockOnboardingService },
          { provide: Router,            useValue: mockRouter            },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => 'invite-token' } } } },
        ],
      }).compileComponents();
      const f = TestBed.createComponent(StaffProfileComponent);
      f.detectChanges();
      expect(f.componentInstance.tenantName()).toBe('City Vet');
    });
  });

  describe('newUserForm', () => {
    beforeEach(async () => setup(null));

    it('has the required form controls', () => {
      expect(component.newUserForm.contains('firstName')).toBe(true);
      expect(component.newUserForm.contains('lastName')).toBe(true);
      expect(component.newUserForm.contains('email')).toBe(true);
      expect(component.newUserForm.contains('password')).toBe(true);
      expect(component.newUserForm.contains('confirmPassword')).toBe(true);
    });

    it('is invalid when empty', () => {
      expect(component.newUserForm.valid).toBe(false);
    });

    it('is valid when all required fields are correctly filled', () => {
      component.newUserForm.patchValue({
        firstName: 'Jane',
        lastName: 'Vet',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });
      expect(component.newUserForm.valid).toBe(true);
    });

    it('detects password mismatch', () => {
      component.newUserForm.patchValue({
        firstName: 'Jane',
        lastName: 'Vet',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'different',
      });
      // Mark confirmPassword dirty so the getter returns true
      component.newUserForm.get('confirmPassword')!.markAsDirty();
      expect(component.passwordMismatch).toBe(true);
    });
  });

  describe('createAccount()', () => {
    beforeEach(async () => setup(null));

    it('does not call completeStaffOnboarding when form is invalid', () => {
      component.createAccount();
      expect(mockOnboardingService.completeStaffOnboarding).not.toHaveBeenCalled();
    });

    it('calls completeStaffOnboarding and navigates to login on success', async () => {
      mockOnboardingService.completeStaffOnboarding.mockReturnValue(of({ userId: 'user-123' }));

      component.newUserForm.patchValue({
        firstName: 'Jane',
        lastName: 'Vet',
        email: 'jane@example.com',
        password: 'password123',
        confirmPassword: 'password123',
      });

      component.createAccount();

      expect(mockOnboardingService.completeStaffOnboarding).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/auth/login']);
      expect(component.loading()).toBe(false);
    });
  });
});
