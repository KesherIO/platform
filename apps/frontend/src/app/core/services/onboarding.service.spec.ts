import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OnboardingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── Initial state (pure signal reads — no HTTP needed) ────────────────────

  describe('initial state', () => {
    it('has empty tenantId', () => {
      expect(service.getOnboardingState()().tenantId).toBe('');
    });

    it('starts at welcome step', () => {
      expect(service.getOnboardingState()().step).toBe('welcome');
    });

    it('marks first user as true', () => {
      expect(service.getOnboardingState()().isFirstUser).toBe(true);
    });
  });

  // ── Pure state mutations (no HTTP) ─────────────────────────────────────────

  describe('updateStep()', () => {
    it('updates the current step', () => {
      service.updateStep('admin-profile');
      expect(service.getOnboardingState()().step).toBe('admin-profile');
    });
  });

  describe('resetOnboarding()', () => {
    it('resets state to initial values', () => {
      service.updateStep('admin-profile');
      service.resetOnboarding();
      const state = service.getOnboardingState()();
      expect(state.tenantId).toBe('');
      expect(state.step).toBe('welcome');
      expect(state.isFirstUser).toBe(true);
    });
  });

  describe('storeClinicSetup()', () => {
    it('updates step to admin-profile and stores clinic data', () => {
      service['onboardingState'].update((s) => ({
        ...s,
        prefillClinicEmail: 'clinic@test.com',
      }));

      service.storeClinicSetup({
        name: 'My Clinic',
        address: '123 Main St',
        city: 'Austin',
        telephone: '555-0000',
        email: 'clinic@test.com',
        notificationMethod: 'email',
      });

      const state = service.getOnboardingState()();
      expect(state.step).toBe('admin-profile');
      expect(state.clinic?.name).toBe('My Clinic');
    });
  });

  describe('storeAdminProfileDraft()', () => {
    it('saves draft without advancing step', () => {
      service.storeAdminProfileDraft({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'j@e.com',
        telephone: '555-1234',
      });
      const draft = service.getOnboardingState()().adminProfileDraft;
      expect(draft?.firstName).toBe('Jane');
      expect(service.getOnboardingState()().step).toBe('welcome'); // step unchanged
    });
  });

  describe('completeOnboarding()', () => {
    it('updates step to complete', () => {
      service.completeOnboarding().subscribe();
      expect(service.getOnboardingState()().step).toBe('complete');
    });

    it('emits true', () => {
      let result: boolean | undefined;
      service.completeOnboarding().subscribe((r) => (result = r));
      expect(result).toBe(true);
    });
  });

  // ── HTTP-dependent methods ─────────────────────────────────────────────────

  describe('initializeOnboarding()', () => {
    it('makes GET request to branding endpoint and updates state', () => {
      const branding = { tenantId: 'tenant-abc', tenantName: 'LabX', logoUrl: '', primaryColor: '' };

      service.initializeOnboarding('tenant-abc').subscribe();

      const req = httpMock.expectOne('/api/onboarding/tenant-abc/branding');
      expect(req.request.method).toBe('GET');
      req.flush(branding);

      const state = service.getOnboardingState()();
      expect(state.tenantId).toBe('tenant-abc');
      expect(state.isFirstUser).toBe(true);
    });

    it('sets step to staff-profile and stores invite token when token provided', () => {
      const branding = { tenantId: 'tenant-abc', tenantName: 'LabX', logoUrl: '', primaryColor: '' };

      service.initializeOnboarding('tenant-abc', 'invite-xyz').subscribe();
      httpMock.expectOne('/api/onboarding/tenant-abc/branding').flush(branding);

      const state = service.getOnboardingState()();
      expect(state.step).toBe('staff-profile');
      expect(state.inviteToken).toBe('invite-xyz');
      expect(state.isFirstUser).toBe(false);
    });
  });

  describe('generateMagicLink()', () => {
    it('throws immediately when tenantId is empty', () => {
      let errorThrown = false;
      service.generateMagicLink().subscribe({ error: () => (errorThrown = true) });
      expect(errorThrown).toBe(true);
      httpMock.expectNone('/api/onboarding/invite');
    });

    it('makes POST request when tenantId is set', () => {
      service['onboardingState'].update((s) => ({ ...s, tenantId: 'tenant-abc' }));

      service.generateMagicLink().subscribe();

      const req = httpMock.expectOne('/api/onboarding/invite?tenantId=tenant-abc');
      expect(req.request.method).toBe('POST');
      req.flush({ token: 'tok-123', tenantId: 'tenant-abc', expiresAt: new Date().toISOString() });
    });
  });

  describe('verifyOnboardingToken()', () => {
    it('makes GET request and stores token in state on valid response', () => {
      service.verifyOnboardingToken('hex-abc').subscribe();

      const req = httpMock.expectOne('/api/onboarding/verify/hex-abc');
      expect(req.request.method).toBe('GET');
      req.flush({ valid: true, type: 'ADMIN', clinicName: 'City Vet', clinicEmail: 'info@cityvet.com' });

      const state = service.getOnboardingState()();
      expect(state.onboardingToken).toBe('hex-abc');
      expect(state.prefillClinicName).toBe('City Vet');
      expect(state.step).toBe('clinic-setup');
    });

    it('does not update state on invalid token response', () => {
      service.verifyOnboardingToken('bad-token').subscribe();
      httpMock.expectOne('/api/onboarding/verify/bad-token').flush({ valid: false, reason: 'expired' });

      // Step should remain unchanged
      expect(service.getOnboardingState()().step).toBe('welcome');
    });
  });
});
