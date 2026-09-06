-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'PROFILE_REQUIRED', 'VERIFICATION_PENDING', 'ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "user_tenant_memberships"
    ADD COLUMN "isOrderingVet" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE';

-- Backfill: existing VET memberships become ordering vets
UPDATE "user_tenant_memberships" SET "isOrderingVet" = true WHERE "role" = 'VET';
