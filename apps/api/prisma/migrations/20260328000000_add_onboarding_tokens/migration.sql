-- CreateEnum
CREATE TYPE "OnboardingTokenType" AS ENUM ('ADMIN');

-- CreateTable
CREATE TABLE "onboarding_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" "OnboardingTokenType" NOT NULL DEFAULT 'ADMIN',
    "clinicName" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "biometClinicId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_tokens_token_key" ON "onboarding_tokens"("token");

-- CreateIndex
CREATE INDEX "onboarding_tokens_token_idx" ON "onboarding_tokens"("token");

-- CreateIndex
CREATE INDEX "onboarding_tokens_adminEmail_idx" ON "onboarding_tokens"("adminEmail");