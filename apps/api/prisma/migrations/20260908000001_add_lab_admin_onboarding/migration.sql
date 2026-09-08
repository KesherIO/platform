-- AlterEnum
ALTER TYPE "OnboardingTokenType" ADD VALUE 'LAB_ADMIN';

-- AlterTable
ALTER TABLE "onboarding_tokens"
    ADD COLUMN "labName" TEXT,
    ADD COLUMN "labEmail" TEXT;
