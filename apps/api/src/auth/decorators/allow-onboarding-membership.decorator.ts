import { SetMetadata } from '@nestjs/common';

export const ALLOW_ONBOARDING_MEMBERSHIP_KEY = 'allowOnboardingMembership';

/**
 * Lets TenantGuard admit a clinic member who is still onboarding
 * (PROFILE_REQUIRED or VERIFICATION_PENDING) — only for the routes those
 * members need to finish onboarding. Every other clinic route requires an
 * ACTIVE membership; SUSPENDED and INVITED members are never admitted.
 *
 * @example
 * @AllowOnboardingMembership()
 * @Get('status')
 * getStatus(...) { ... }
 */
export const AllowOnboardingMembership = () =>
  SetMetadata(ALLOW_ONBOARDING_MEMBERSHIP_KEY, true);
