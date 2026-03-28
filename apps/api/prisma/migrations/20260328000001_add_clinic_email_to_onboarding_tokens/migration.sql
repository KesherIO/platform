-- Add clinicEmail column to onboarding_tokens table.
-- This is the clinic's contact email (Tenant.email), distinct from adminEmail
-- which is the login email for the admin user (User.email / Supabase auth).
-- Existing rows (if any) get an empty string default; the column is NOT NULL
-- going forward because Biomet always supplies it when creating a link.

ALTER TABLE "onboarding_tokens"
  ADD COLUMN "clinicEmail" TEXT NOT NULL DEFAULT '';

-- Remove the DEFAULT after backfill so new rows must always supply a value.
ALTER TABLE "onboarding_tokens"
  ALTER COLUMN "clinicEmail" DROP DEFAULT;