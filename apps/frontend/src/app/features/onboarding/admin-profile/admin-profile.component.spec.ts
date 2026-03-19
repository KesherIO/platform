import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AdminProfileComponent } from './admin-profile.component';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { Clipboard } from '@angular/cdk/clipboard';
import { provideTranslateService } from '@ngx-translate/core';
import { MagicLinkInvite } from '../../../core/models/onboarding.model';

describe('AdminProfileComponent', () => {
  let component: AdminProfileComponent;
  let fixture: ComponentFixture<AdminProfileComponent>;
  let mockOnboardingService: jasmine.SpyObj<OnboardingService>;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockClipboard: jasmine.SpyObj<Clipboard>;

  beforeEach(async () => {
    mockOnboardingService = jasmine.createSpyObj('OnboardingService', [
      'saveAdminProfile',
      'generateMagicLink',
      'completeOnboarding',
    ]);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockClipboard = jasmine.createSpyObj('Clipboard', ['copy']);

    await TestBed.configureTestingModule({
      imports: [AdminProfileComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: OnboardingService, useValue: mockOnboardingService },
        { provide: Router, useValue: mockRouter },
        { provide: Clipboard, useValue: mockClipboard },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize the profile form with required controls', () => {
    expect(component.profileForm.contains('fullName')).toBeTrue();
    expect(component.profileForm.contains('telephone')).toBeTrue();
    expect(component.profileForm.contains('email')).toBeTrue();
  });

  describe('form validation', () => {
    it('should be invalid when empty', () => {
      expect(component.profileForm.valid).toBeFalse();
    });

    it('should be valid when all fields are correctly filled', () => {
      component.profileForm.patchValue({
        fullName: 'Dr. Smith',
        telephone: '555-1234',
        email: 'admin@test.com',
      });
      expect(component.profileForm.valid).toBeTrue();
    });

    it('should be invalid with short fullName', () => {
      component.profileForm.patchValue({ fullName: 'A', telephone: '555', email: 'a@b.com' });
      expect(component.profileForm.get('fullName')?.valid).toBeFalse();
    });
  });

  describe('onSave()', () => {
    it('should not call saveAdminProfile when form is invalid', () => {
      component.onSave();
      expect(mockOnboardingService.saveAdminProfile).not.toHaveBeenCalled();
    });

    it('should call saveAdminProfile with role "admin" appended', fakeAsync(() => {
      mockOnboardingService.saveAdminProfile.and.returnValue(of({ userId: 'user-123' }));

      component.profileForm.patchValue({
        fullName: 'Dr. Smith',
        telephone: '555-1234',
        email: 'admin@test.com',
      });

      component.onSave();
      tick();

      expect(mockOnboardingService.saveAdminProfile).toHaveBeenCalledWith(
        jasmine.objectContaining({ role: 'admin' })
      );
    }));

    it('should set profileSaved and showInviteSection to true on success', fakeAsync(() => {
      mockOnboardingService.saveAdminProfile.and.returnValue(of({ userId: 'user-123' }));

      component.profileForm.patchValue({
        fullName: 'Dr. Smith',
        telephone: '555-1234',
        email: 'admin@test.com',
      });

      component.onSave();
      tick();

      expect(component.profileSaved()).toBeTrue();
      expect(component.showInviteSection()).toBeTrue();
      expect(component.loading()).toBeFalse();
    }));
  });

  describe('onCreateMagicLink()', () => {
    it('should set magicLink signal after generation', fakeAsync(() => {
      const mockInvite: MagicLinkInvite = {
        clinicId: 'clinic-123',
        tenantId: 'tenant-abc',
        invitedBy: 'admin-user',
        expiresAt: new Date(),
        token: 'invite-abc123',
      };
      mockOnboardingService.generateMagicLink.and.returnValue(of(mockInvite));

      component.onCreateMagicLink();
      tick();

      expect(component.magicLink()).toContain('invite-abc123');
      expect(component.magicLink()).toContain('tenant-abc');
      expect(component.generatingLink()).toBeFalse();
    }));
  });

  describe('copyToClipboard()', () => {
    it('should set copied to true on successful copy', fakeAsync(() => {
      mockClipboard.copy.and.returnValue(true);
      component.magicLink.set('http://example.com/invite');

      component.copyToClipboard();

      expect(component.copied()).toBeTrue();

      tick(2000);
      expect(component.copied()).toBeFalse();
    }));

    it('should not set copied to true when clipboard copy fails', () => {
      mockClipboard.copy.and.returnValue(false);
      component.magicLink.set('http://example.com/invite');

      component.copyToClipboard();

      expect(component.copied()).toBeFalse();
    });
  });

  describe('onEnterApp()', () => {
    it('should navigate to /cases after completing onboarding', fakeAsync(() => {
      mockOnboardingService.completeOnboarding.and.returnValue(of(true));

      component.onEnterApp();
      tick();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/cases']);
    }));
  });
});