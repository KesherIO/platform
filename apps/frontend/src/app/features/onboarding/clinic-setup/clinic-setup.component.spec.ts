import { ComponentFixture, TestBed} from '@angular/core/testing';
import { Router } from '@angular/router';
import { of} from 'rxjs';
import { ClinicSetupComponent } from './clinic-setup.component';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { provideTranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { OnboardingState } from '../../../core/models';

describe('ClinicSetupComponent', () => {
  let component: ClinicSetupComponent;
  let fixture: ComponentFixture<ClinicSetupComponent>;
  let mockOnboardingService: {
    storeClinicSetup: ReturnType<typeof vi.fn>;
    getOnboardingState: ReturnType<typeof vi.fn>;
  };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };

  const mockState = signal<OnboardingState>({ tenantId: 'tenant-abc', step: 'welcome', isFirstUser: true });

  beforeEach(async () => {
    mockOnboardingService = {
      storeClinicSetup: vi.fn(),
      getOnboardingState: vi.fn().mockReturnValue(mockState.asReadonly()),
    };
    mockRouter = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ClinicSetupComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: OnboardingService, useValue: mockOnboardingService },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClinicSetupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize the clinic form with required controls', () => {
    expect(component.clinicForm.contains('name')).toBe(true);
    expect(component.clinicForm.contains('address')).toBe(true);
    expect(component.clinicForm.contains('city')).toBe(true);
    expect(component.clinicForm.contains('country')).toBe(true);
    expect(component.clinicForm.contains('telephone')).toBe(true);
    expect(component.clinicForm.contains('notificationMethod')).toBe(true);
  });

  it('should default notificationMethod to "email"', () => {
    expect(component.clinicForm.get('notificationMethod')?.value).toBe('email');
  });

  it('should have two notification options', () => {
    expect(component.notificationOptions.length).toBe(2);
    expect(component.notificationOptions[0].value).toBe('email');
    expect(component.notificationOptions[1].value).toBe('sms');
  });

  describe('form validation', () => {
    it('should be invalid when empty', () => {
      expect(component.clinicForm.valid).toBe(false);
    });

    it('should be invalid with a name shorter than 2 characters', () => {
      component.clinicForm.patchValue({
        name: 'M',
        address: '123 Main St',
        city: 'Austin',
        country: 'US',
        telephone: '555-0000',
        notificationMethod: 'email',
      });
      expect(component.clinicForm.get('name')?.valid).toBe(false);
    });

    it('should be valid when all required fields are filled correctly', () => {
      component.clinicForm.patchValue({
        name: 'My Clinic',
        address: '123 Main St',
        city: 'Cali',
        country: 'COL',
        telephone: '555-0000',
        notificationMethod: 'email',
      });
      expect(component.clinicForm.valid).toBe(true);
    });
  });

  describe('onSubmit()', () => {
    it('should not call storeClinicSetup when form is invalid', () => {
      component.onSubmit();
      expect(mockOnboardingService.storeClinicSetup).not.toHaveBeenCalled();
    });

    it('should call saveClinicSetup and navigate on success', () => {
      mockOnboardingService.storeClinicSetup.mockReturnValue(of({ clinicId: 'clinic-123' }));
      component.clinicForm.patchValue({
        name: 'My Clinic',
        address: '123 Main St',
        city: 'Austin',
        country: 'US',
        telephone: '555-0000',
        notificationMethod: 'email',
      });

      component.onSubmit();

      expect(mockOnboardingService.storeClinicSetup).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/onboarding/admin-profile']);
      expect(component.uploading()).toBe(false);
    });
  });
});
