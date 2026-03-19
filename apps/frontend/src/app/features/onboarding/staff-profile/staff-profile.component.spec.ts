import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { StaffProfileComponent } from './staff-profile.component';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { provideTranslateService } from '@ngx-translate/core';

describe('StaffProfileComponent', () => {
  let component: StaffProfileComponent;
  let fixture: ComponentFixture<StaffProfileComponent>;
  let mockOnboardingService: jasmine.SpyObj<OnboardingService>;
  let mockRouter: jasmine.SpyObj<Router>;

  function createComponent(queryParams: Record<string, string> = {}) {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          queryParamMap: { get: (key: string) => queryParams[key] ?? null },
        },
      },
    });
    fixture = TestBed.createComponent(StaffProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    mockOnboardingService = jasmine.createSpyObj('OnboardingService', [
      'verifyMagicLink',
      'initializeOnboarding',
      'saveStaffProfile',
      'completeOnboarding',
    ]);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [StaffProfileComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: OnboardingService, useValue: mockOnboardingService },
        { provide: Router, useValue: mockRouter },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
      ],
    }).compileComponents();
  });

  it('should create', () => {
    createComponent();
    expect(component).toBeTruthy();
  });

  it('should initialize staff form with required controls', () => {
    createComponent();
    expect(component.staffForm.contains('fullName')).toBeTrue();
    expect(component.staffForm.contains('telephone')).toBeTrue();
    expect(component.staffForm.contains('email')).toBeTrue();
    expect(component.staffForm.contains('role')).toBeTrue();
  });

  it('should have three role options', () => {
    createComponent();
    expect(component.roleOptions.length).toBe(3);
    const values = component.roleOptions.map((o) => o.value);
    expect(values).toContain('vet');
    expect(values).toContain('tech');
    expect(values).toContain('admin');
  });

  describe('magic link verification', () => {
    it('should call verifyMagicLink when token and tenantId are in query params', fakeAsync(() => {
      mockOnboardingService.verifyMagicLink.and.returnValue(
        of({ tenantId: 'tenant-abc', clinicId: 'clinic-123' })
      );
      mockOnboardingService.initializeOnboarding.and.returnValue(
        of({ tenantId: 'tenant-abc', tenantName: 'LabX', logoUrl: '', primaryColor: '' })
      );

      createComponent({ token: 'invite-xyz', tenantId: 'tenant-abc' });
      tick();

      expect(mockOnboardingService.verifyMagicLink).toHaveBeenCalledWith('invite-xyz');
    }));

    it('should not call verifyMagicLink when no token in query params', () => {
      createComponent();
      expect(mockOnboardingService.verifyMagicLink).not.toHaveBeenCalled();
    });
  });

  describe('form validation', () => {
    beforeEach(() => createComponent());

    it('should be invalid when empty', () => {
      expect(component.staffForm.valid).toBeFalse();
    });

    it('should be valid when all fields are filled', () => {
      component.staffForm.patchValue({
        fullName: 'Jane Vet',
        telephone: '555-5678',
        email: 'staff@test.com',
        role: 'vet',
      });
      expect(component.staffForm.valid).toBeTrue();
    });
  });

  describe('onSubmit()', () => {
    beforeEach(() => createComponent());

    it('should not call saveStaffProfile when form is invalid', () => {
      component.onSubmit();
      expect(mockOnboardingService.saveStaffProfile).not.toHaveBeenCalled();
    });

    it('should call saveStaffProfile, completeOnboarding, and navigate on success', fakeAsync(() => {
      mockOnboardingService.saveStaffProfile.and.returnValue(of({ userId: 'user-456' }));
      mockOnboardingService.completeOnboarding.and.returnValue(of(true));

      component.staffForm.patchValue({
        fullName: 'Jane Vet',
        telephone: '555-5678',
        email: 'staff@test.com',
        role: 'vet',
      });

      component.onSubmit();
      tick();

      expect(mockOnboardingService.saveStaffProfile).toHaveBeenCalled();
      expect(mockOnboardingService.completeOnboarding).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/cases']);
      expect(component.loading()).toBeFalse();
    }));
  });
});