-- Rename TenantType enum value VETAI -> PLATFORM
ALTER TYPE "TenantType" RENAME VALUE 'VETAI' TO 'PLATFORM';

-- Rename OnboardingToken column biometClinicId -> externalClinicId
ALTER TABLE "onboarding_tokens" RENAME COLUMN "biometClinicId" TO "externalClinicId";
