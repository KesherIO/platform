import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { WelcomeComponent } from './welcome.component';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { LanguageService } from '../../../core/services/language.service';
import { provideTranslateService } from '@ngx-translate/core';

describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;
  let mockOnboardingService: jasmine.SpyObj<OnboardingService>;
  let mockLanguageService: jasmine.SpyObj<LanguageService>;
  let mockRouter: jasmine.SpyObj<Router>;

  async function setup(tenantId: string | null = null) {
    mockOnboardingService = jasmine.createSpyObj('OnboardingService', ['initializeOnboarding']);
    mockLanguageService = jasmine.createSpyObj('LanguageService', ['setLanguage'], {
      currentLang: jasmine.createSpy().and.returnValue('en'),
    });
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);

    if (tenantId) {
      mockOnboardingService.initializeOnboarding.and.returnValue(
        of({ tenantId, tenantName: 'TestClinic', logoUrl: '', primaryColor: '' })
      );
    }

    await TestBed.configureTestingModule({
      imports: [WelcomeComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: OnboardingService, useValue: mockOnboardingService },
        { provide: LanguageService, useValue: mockLanguageService },
        { provide: Router, useValue: mockRouter },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (key: string) => (key === 'tenantId' && tenantId ? tenantId : null),
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
  }

  describe('without tenantId in query params', () => {
    beforeEach(async () => setup());

    it('should create', () => {
      fixture.detectChanges();
      expect(component).toBeTruthy();
    });

    it('should have default tenant name "LabX"', () => {
      fixture.detectChanges();
      expect(component.tenantName()).toBe('LabX');
    });

    it('should not call initializeOnboarding', () => {
      fixture.detectChanges();
      expect(mockOnboardingService.initializeOnboarding).not.toHaveBeenCalled();
    });

    it('onContinue() should navigate to /onboarding/clinic-setup', () => {
      fixture.detectChanges();
      component.onContinue();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/onboarding/clinic-setup']);
    });

    it('onLanguageChange() should call languageService.setLanguage', () => {
      fixture.detectChanges();
      component.onLanguageChange('es');
      expect(mockLanguageService.setLanguage).toHaveBeenCalledWith('es');
    });
  });

  describe('when tenantId is present in query params', () => {
    beforeEach(async () => setup('tenant-abc'));

    it('should call initializeOnboarding with the tenantId', fakeAsync(() => {
      fixture.detectChanges();
      tick();
      expect(mockOnboardingService.initializeOnboarding).toHaveBeenCalledWith('tenant-abc');
    }));

    it('should update tenantName from branding response', fakeAsync(() => {
      fixture.detectChanges();
      tick();
      expect(component.tenantName()).toBe('TestClinic');
    }));
  });
});