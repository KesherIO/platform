-- Link report signers to lab team members (Biomet decision 2026-10-15):
-- an ANALYST signer must be a team member (checked in the API); reviewers may
-- be people without an account. Additive only: existing signers stay unlinked
-- until an Owner/Admin links them.

-- Enum values first; they are not used in this migration.
ALTER TYPE "MembershipEventType" ADD VALUE 'SIGNER_LINKED';
ALTER TYPE "MembershipEventType" ADD VALUE 'SIGNER_UNLINKED';
ALTER TYPE "MembershipEventType" ADD VALUE 'SIGNER_ROLES_CHANGED';
ALTER TYPE "MembershipEventType" ADD VALUE 'SIGNATURE_REPLACED';

ALTER TABLE "lab_signers" ADD COLUMN "userId" TEXT;

-- One signer profile per person per lab (NULLs don't collide).
CREATE UNIQUE INDEX "lab_signers_laboratoryProfileId_userId_key"
  ON "lab_signers"("laboratoryProfileId", "userId");

ALTER TABLE "lab_signers"
  ADD CONSTRAINT "lab_signers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "membership_events" ADD COLUMN "details" JSONB;
