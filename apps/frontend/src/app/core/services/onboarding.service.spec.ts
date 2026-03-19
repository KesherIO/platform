import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  let service: OnboardingService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OnboardingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should have empty tenantId', () => {
      expect(service.getOnboardingState()().tenantId).toBe('');
    });

    it('should start at welcome step', () => {
      expect(service.getOnboardingState()().step).toBe('welcome');
    });

    it('should mark first user as true', () => {
      expect(service.getOnboardingState()().isFirstUser).toBeTrue();
    });
  });

  describe('initializeOnboarding()', () => {
    it('should update tenantId and set step to welcome for first user', fakeAsync(() => {
      service.initializeOnboarding('tenant-abc').subscribe();
      tick(500);

      const state = service.getOnboardingState()();
      expect(state.tenantId).toBe('tenant-abc');
      expect(state.step).toBe('welcome');
      expect(state.isFirstUser).toBeTrue();
    }));

    it('should set step to staff-profile when invite token is provided', fakeAsync(() => {
      service.initializeOnboarding('tenant-abc', 'invite-token-xyz').subscribe();
      tick(500);

      const state = service.getOnboardingState()();
      expect(state.step).toBe('staff-profile');
      expect(state.isFirstUser).toBeFalse();
      expect(state.inviteToken).toBe('invite-token-xyz');
    }));

    it('should return branding data', fakeAsync(() => {
      let branding: { tenantName: string } | undefined;
      service.initializeOnboarding('tenant-abc').subscribe((b) => (branding = b));
      tick(500);

      expect(branding?.tenantName).toBe('LabX');
    }));
  });

  describe('saveClinicSetup()', () => {
    it('should update step to admin-profile', fakeAsync(() => {
      const clinicData = {
        tenantId: 'tenant-abc',
        name: 'My Clinic',
        address: '123 Main St',
        email: 'clinic@test.com',
        telephone: '555-0000',
        notificationMethod: 'email' as const,
      };

      service.saveClinicSetup(clinicData).subscribe();
      tick(800);

      expect(service.getOnboardingState()().step).toBe('admin-profile');
    }));

    it('should return clinicId', fakeAsync(() => {
      const clinicData = {
        tenantId: 'tenant-abc',
        name: 'My Clinic',
        address: '123 Main St',
        email: 'clinic@test.com',
        telephone: '555-0000',
        notificationMethod: 'email' as const,
      };

      let result: { clinicId: string } | undefined;
      service.saveClinicSetup(clinicData).subscribe((r) => (result = r));
      tick(800);

      expect(result?.clinicId).toBe('clinic-123');
    }));
  });

  describe('saveAdminProfile()', () => {
    it('should update step to staff-invite', fakeAsync(() => {
      const profileData = {
        fullName: 'Dr. Smith',
        telephone: '555-1234',
        email: 'admin@test.com',
        role: 'admin' as const,
      };

      service.saveAdminProfile(profileData).subscribe();
      tick(800);

      expect(service.getOnboardingState()().step).toBe('staff-invite');
    }));

    it('should store admin profile in state', fakeAsync(() => {
      const profileData = {
        fullName: 'Dr. Smith',
        telephone: '555-1234',
        email: 'admin@test.com',
        role: 'admin' as const,
      };

      service.saveAdminProfile(profileData).subscribe();
      tick(800);

      expect(service.getOnboardingState()().adminProfile).toEqual(profileData);
    }));
  });

  describe('saveStaffProfile()', () => {
    it('should update step to complete', fakeAsync(() => {
      const profileData = {
        fullName: 'Jane Vet',
        telephone: '555-5678',
        email: 'staff@test.com',
        role: 'vet' as const,
      };

      service.saveStaffProfile(profileData).subscribe();
      tick(800);

      expect(service.getOnboardingState()().step).toBe('complete');
    }));
  });

  describe('generateMagicLink()', () => {
    it('should throw error when tenantId is empty', () => {
      let errorThrown = false;
      service.generateMagicLink().subscribe({
        error: () => (errorThrown = true),
      });

      expect(errorThrown).toBeTrue();
    });

    it('should return a magic link invite when tenantId is set', fakeAsync(() => {
      service['onboardingState'].set({
        tenantId: 'tenant-abc',
        step: 'staff-invite',
        isFirstUser: true,
      });

      let invite: { tenantId: string; token: string } | undefined;
      service.generateMagicLink().subscribe((i) => (invite = i));
      tick(500);

      expect(invite?.tenantId).toBe('tenant-abc');
      expect(invite?.token).toMatch(/^invite-/);
    }));
  });

  describe('completeOnboarding()', () => {
    it('should update step to complete', fakeAsync(() => {
      service.completeOnboarding().subscribe();
      tick(500);

      expect(service.getOnboardingState()().step).toBe('complete');
    }));

    it('should return true', fakeAsync(() => {
      let result: boolean | undefined;
      service.completeOnboarding().subscribe((r) => (result = r));
      tick(500);

      expect(result).toBeTrue();
    }));
  });

  describe('updateStep()', () => {
    it('should update the current step', () => {
      service.updateStep('admin-profile');
      expect(service.getOnboardingState()().step).toBe('admin-profile');
    });
  });

  describe('resetOnboarding()', () => {
    it('should reset state to initial values', fakeAsync(() => {
      service.initializeOnboarding('tenant-abc').subscribe();
      tick(500);

      service.resetOnboarding();

      const state = service.getOnboardingState()();
      expect(state.tenantId).toBe('');
      expect(state.step).toBe('welcome');
      expect(state.isFirstUser).toBeTrue();
    }));
  });
});