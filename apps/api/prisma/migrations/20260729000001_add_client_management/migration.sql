-- CreateEnum: ClientType
CREATE TYPE "ClientType" AS ENUM (
  'VETERINARY_CLINIC',
  'INDEPENDENT_VET',
  'BREEDER',
  'FARM',
  'SHELTER',
  'RESEARCH_ORGANIZATION',
  'INDIVIDUAL',
  'OTHER'
);

-- CreateEnum: ClientStatus
CREATE TYPE "ClientStatus" AS ENUM (
  'PENDING',
  'ACTIVE',
  'SUSPENDED'
);

-- AlterTable: tenants — add clientType, clientStatus, primaryContactName
ALTER TABLE "tenants" ADD COLUMN "clientType" "ClientType";
ALTER TABLE "tenants" ADD COLUMN "clientStatus" "ClientStatus";
ALTER TABLE "tenants" ADD COLUMN "primaryContactName" TEXT;

-- AlterTable: onboarding_tokens — add tokenHash, clientType, laboratoryId, revokedAt, createdByUserId; make token optional
ALTER TABLE "onboarding_tokens" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "onboarding_tokens" ADD COLUMN "clientType" "ClientType";
ALTER TABLE "onboarding_tokens" ADD COLUMN "laboratoryId" TEXT;
ALTER TABLE "onboarding_tokens" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "onboarding_tokens" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "onboarding_tokens" ALTER COLUMN "token" DROP NOT NULL;

-- CreateIndex: tokenHash unique
CREATE UNIQUE INDEX "onboarding_tokens_tokenHash_key" ON "onboarding_tokens"("tokenHash");

-- CreateIndex: tokenHash lookup
CREATE INDEX "onboarding_tokens_tokenHash_idx" ON "onboarding_tokens"("tokenHash");

-- Backfill: set existing CLINIC tenants to ACTIVE status
UPDATE "tenants" SET "clientStatus" = 'ACTIVE' WHERE "type" = 'CLINIC';
