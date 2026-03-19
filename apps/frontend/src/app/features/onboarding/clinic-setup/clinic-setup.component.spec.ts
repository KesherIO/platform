import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { ClinicSetupComponent } from './clinic-setup.component';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { provideTranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { OnboardingState } from '../../../core/models/onboarding.model';

describe('ClinicSetupComponent', () => {
  let component: ClinicSetupComponent;
  let fixture: ComponentFixture<ClinicSetupComponent>;
  let mockOnboardingService: jasmine.SpyObj<OnboardingService>;
  let mockRouter: jasmine.SpyObj<Router>;

  const mockState = signal<OnboardingState>({ tenantId: 'tenant-abc', step: 'welcome', isFirstUser: true });

  beforeEach(async () => {
    mockOnboardingService = jasmine.createSpyObj('OnboardingService', [
      'saveClinicSetup',
      'getOnboardingState',
    ]);
    mockOnboardingService.getOnboardingState.and.returnValue(mockState.asReadonly());
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);

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
    expect(component.clinicForm.contains('name')).toBeTrue();
    expect(component.clinicForm.contains('address')).toBeTrue();
    expect(component.clinicForm.contains('email')).toBeTrue();
    expect(component.clinicForm.contains('telephone')).toBeTrue();
    expect(component.clinicForm.contains('notificationMethod')).toBeTrue();
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
      expect(component.clinicForm.valid).toBeFalse();
    });

    it('should be invalid with a name shorter than 2 characters', () => {
      component.clinicForm.patchValue({ name: 'A', address: '123 Main', email: 'test@test.com', telephone: '555' });
      expect(component.clinicForm.get('name')?.valid).toBeFalse();
    });

    it('should be valid when all required fields are filled correctly', () => {
      component.clinicForm.patchValue({
        name: 'My Clinic',
        address: '123 Main St',
        email: 'clinic@test.com',
        telephone: '555-0000',
        notificationMethod: 'email',
      });
      expect(component.clinicForm.valid).toBeTrue();
    });
  });

  describe('onSubmit()', () => {
    it('should not call saveClinicSetup when form is invalid', () => {
      component.onSubmit();
      expect(mockOnboardingService.saveClinicSetup).not.toHaveBeenCalled();
    });

    it('should call saveClinicSetup and navigate on success', fakeAsync(() => {
      mockOnboardingService.saveClinicSetup.and.returnValue(of({ clinicId: 'clinic-123' }));

      component.clinicForm.patchValue({
        name: 'My Clinic',
        address: '123 Main St',
        email: 'clinic@test.com',
        telephone: '555-0000',
        notificationMethod: 'email',
      });

      component.onSubmit();
      tick();

      expect(mockOnboardingService.saveClinicSetup).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/onboarding/admin-profile']);
      expect(component.loading()).toBeFalse();
    }));

    it('should set loading to true while waiting for response', fakeAsync(() => {
      const subject = new Subject<{ clinicId: string }>();
      mockOnboardingService.saveClinicSetup.and.returnValue(subject.asObservable());

      component.clinicForm.patchValue({
        name: 'My Clinic',
        address: '123 Main St',
        email: 'clinic@test.com',
        telephone: '555-0000',
        notificationMethod: 'email',
      });

      component.onSubmit();
      // Observable hasn't emitted yet — loading must be true
      expect(component.loading()).toBeTrue();

      // Resolve the observable
      subject.next({ clinicId: 'clinic-123' });
      subject.complete();
      tick();
      expect(component.loading()).toBeFalse();
    }));
  });
});