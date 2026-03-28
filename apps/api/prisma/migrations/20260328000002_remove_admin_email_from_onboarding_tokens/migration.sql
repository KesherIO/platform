-- Remove adminEmail from onboarding_tokens.
-- The admin's login email is now entered by the admin themselves during onboarding
-- and is no longer pre-supplied by Biomet when creating the link.

ALTER TABLE "onboarding_tokens"
  DROP COLUMN IF EXISTS "adminEmail";