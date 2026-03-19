import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { onboardingGuard, onboardingCompleteGuard } from './onboarding.guard';
import { OnboardingService } from '../services/onboarding.service';

function createRouteSnapshot(params: Record<string, string> = {}): ActivatedRouteSnapshot {
  const route = new ActivatedRouteSnapshot();
  const map = new Map(Object.entries(params));
  Object.defineProperty(route, 'queryParamMap', {
    value: { get: (key: string) => map.get(key) ?? null },
  });
  return route;
}

const mockState = {} as RouterStateSnapshot;

describe('onboardingGuard', () => {
  let onboardingService: OnboardingService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OnboardingService,
        {
          provide: Router,
          useValue: { navigate: jasmine.createSpy('navigate') },
        },
      ],
    });

    onboardingService = TestBed.inject(OnboardingService);
    router = TestBed.inject(Router);
  });

  it('should allow access when tenantId is in query params', () => {
    const route = createRouteSnapshot({ tenantId: 'tenant-abc' });
    const result = TestBed.runInInjectionContext(() => onboardingGuard(route, mockState));
    expect(result).toBeTrue();
  });

  it('should allow access when invite token is in query params', () => {
    const route = createRouteSnapshot({ token: 'invite-token-xyz' });
    const result = TestBed.runInInjectionContext(() => onboardingGuard(route, mockState));
    expect(result).toBeTrue();
  });

  it('should redirect to / when no tenantId or token', () => {
    const route = createRouteSnapshot();
    const result = TestBed.runInInjectionContext(() => onboardingGuard(route, mockState));
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('should redirect to /cases when onboarding is complete', () => {
    onboardingService.updateStep('complete');
    const route = createRouteSnapshot({ tenantId: 'tenant-abc' });

    const result = TestBed.runInInjectionContext(() => onboardingGuard(route, mockState));

    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/cases']);
  });
});

describe('onboardingCompleteGuard', () => {
  let onboardingService: OnboardingService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OnboardingService,
        {
          provide: Router,
          useValue: { navigate: jasmine.createSpy('navigate') },
        },
      ],
    });

    onboardingService = TestBed.inject(OnboardingService);
    router = TestBed.inject(Router);
  });

  it('should allow access when onboarding is complete', () => {
    onboardingService.updateStep('complete');
    const route = createRouteSnapshot();

    const result = TestBed.runInInjectionContext(() => onboardingCompleteGuard(route, mockState));

    expect(result).toBeTrue();
  });

  it('should allow access when there is no tenantId (fresh start)', () => {
    const route = createRouteSnapshot();
    const result = TestBed.runInInjectionContext(() => onboardingCompleteGuard(route, mockState));
    expect(result).toBeTrue();
  });

  it('should redirect to /onboarding when onboarding is incomplete with a tenantId', () => {
    onboardingService['onboardingState'].set({
      tenantId: 'tenant-abc',
      step: 'welcome',
      isFirstUser: true,
    });
    const route = createRouteSnapshot();

    const result = TestBed.runInInjectionContext(() => onboardingCompleteGuard(route, mockState));

    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding']);
  });
});