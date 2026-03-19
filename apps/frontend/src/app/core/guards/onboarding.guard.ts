import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { OnboardingService } from '../services/onboarding.service';

export const onboardingGuard: CanActivateFn = (route, _state) => {
  const router = inject(Router);
  const onboardingService = inject(OnboardingService);

  const onboardingState = onboardingService.getOnboardingState()();

  // If onboarding is complete, redirect to main app
  if (onboardingState.step === 'complete') {
    router.navigate(['/cases']);
    return false;
  }

  // Check if tenantId exists in state or query params
  const tenantId = route.queryParamMap.get('tenantId') || onboardingState.tenantId;

  if (!tenantId && !route.queryParamMap.get('token')) {
    // No tenantId or invite token, redirect to home or error page
    console.error('Missing tenantId or invite token');
    router.navigate(['/']);
    return false;
  }

  return true;
};

export const onboardingCompleteGuard: CanActivateFn = (_route, _state) => {
  const router = inject(Router);
  const onboardingService = inject(OnboardingService);

  const onboardingState = onboardingService.getOnboardingState()();

  // If onboarding is not complete, redirect to onboarding
  if (onboardingState.step !== 'complete' && onboardingState.tenantId) {
    router.navigate(['/onboarding']);
    return false;
  }

  return true;
};