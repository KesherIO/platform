import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { WelcomeComponent } from './welcome.component';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { LanguageService } from '../../../core/services/language.service';
import { provideTranslateService } from '@ngx-translate/core';
import { OnboardingState } from '../../../core/models';

function makeState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { tenantId: '', step: 'welcome', isFirstUser: true, ...overrides };
}

describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;
  let mockOnboardingService: {
    getOnboardingState: ReturnType<typeof vi.fn>;
    verifyOnboardingToken: ReturnType<typeof vi.fn>;
  };
  let mockLanguageService: {
    setLanguage: ReturnType<typeof vi.fn>;
    currentLang: ReturnType<typeof vi.fn>;
  };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };

  async function setup(options: { token?: string; storedState?: Partial<OnboardingState> } = {}) {
    TestBed.resetTestingModule();
    const stateSignal = signal(makeState(options.storedState));

    mockOnboardingService = {
      getOnboardingState: vi.fn().mockReturnValue(stateSignal.asReadonly()),
      verifyOnboardingToken: vi.fn(),
    };
    mockLanguageService = {
      setLanguage: vi.fn(),
      currentLang: vi.fn().mockReturnValue('en'),
    };
    mockRouter = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [WelcomeComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: OnboardingService, useValue: mockOnboardingService },
        { provide: LanguageService,   useValue: mockLanguageService   },
        { provide: Router,            useValue: mockRouter            },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (key: string) => key === 'token' ? (options.token ?? null) : null,
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
  }

  it('should create', async () => {
    await setup();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('no token in URL', () => {
    beforeEach(async () => setup());

    it('sets errorReason to no_token and loading to false', () => {
      fixture.detectChanges();
      expect(component.errorReason()).toBe('no_token');
      expect(component.loading()).toBe(false);
    });

    it('does not call verifyOnboardingToken', () => {
      fixture.detectChanges();
      expect(mockOnboardingService.verifyOnboardingToken).not.toHaveBeenCalled();
    });
  });

  describe('stored state (back navigation)', () => {
    beforeEach(async () => setup({
      storedState: { onboardingToken: 'hex-abc', prefillClinicName: 'Stored Clinic', step: 'clinic-setup' },
    }));

    it('shows stored clinic name without calling verifyOnboardingToken', () => {
      fixture.detectChanges();
      expect(component.clinicName()).toBe('Stored Clinic');
      expect(component.loading()).toBe(false);
      expect(mockOnboardingService.verifyOnboardingToken).not.toHaveBeenCalled();
    });
  });

  describe('token in URL', () => {
    it('sets clinicName on valid token response', async () => {
      await setup({ token: 'valid-hex' });
      mockOnboardingService.verifyOnboardingToken.mockReturnValue(
        of({ valid: true, type: 'ADMIN', clinicName: 'City Vet', clinicEmail: 'info@cityvet.com' })
      );

      fixture.detectChanges();

      expect(mockOnboardingService.verifyOnboardingToken).toHaveBeenCalledWith('valid-hex');
      expect(component.clinicName()).toBe('City Vet');
      expect(component.loading()).toBe(false);
    });

    it('sets errorReason on invalid token (expired)', async () => {
      await setup({ token: 'expired-hex' });
      mockOnboardingService.verifyOnboardingToken.mockReturnValue(
        of({ valid: false, reason: 'expired' })
      );

      fixture.detectChanges();

      expect(component.errorReason()).toBe('expired');
      expect(component.loading()).toBe(false);
    });

    it('sets errorReason to network on HTTP error', async () => {
      await setup({ token: 'bad-hex' });
      mockOnboardingService.verifyOnboardingToken.mockReturnValue(
        throwError(() => new Error('Network error'))
      );

      fixture.detectChanges();

      expect(component.errorReason()).toBe('network');
      expect(component.loading()).toBe(false);
    });
  });

  describe('onContinue()', () => {
    it('navigates to /onboarding/clinic-setup', async () => {
      await setup();
      fixture.detectChanges();
      component.onContinue();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/onboarding/clinic-setup']);
    });
  });

  describe('onLanguageChange()', () => {
    it('calls languageService.setLanguage with the selected language', async () => {
      await setup();
      fixture.detectChanges();
      component.onLanguageChange('es');
      expect(mockLanguageService.setLanguage).toHaveBeenCalledWith('es');
    });
  });
});
