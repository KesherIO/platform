-- onboarding_tokens.clinicTenantId was added to schema.prisma in #30 without a
-- migration. Some environments already have it (db push / manual), others may
-- not, so every step is idempotent.

-- 1. Column
ALTER TABLE "onboarding_tokens" ADD COLUMN IF NOT EXISTS "clinicTenantId" TEXT;

-- 2. Index
CREATE INDEX IF NOT EXISTS "onboarding_tokens_clinicTenantId_idx"
  ON "onboarding_tokens"("clinicTenantId");

-- 3. Foreign key (ON DELETE SET NULL, matching schema.prisma)
--    If the column existed without the FK, deleted clinics may have left
--    dangling ids behind. Null them first — exactly what ON DELETE SET NULL
--    would have done — otherwise the constraint cannot be created. Onboarding
--    treats a lab invitation without clinicTenantId as revoked, so these can
--    no longer create a duplicate clinic.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'onboarding_tokens_clinicTenantId_fkey'
  ) THEN
    UPDATE "onboarding_tokens" ot
    SET "clinicTenantId" = NULL
    WHERE ot."clinicTenantId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "tenants" t WHERE t."id" = ot."clinicTenantId");

    ALTER TABLE "onboarding_tokens"
      ADD CONSTRAINT "onboarding_tokens_clinicTenantId_fkey"
      FOREIGN KEY ("clinicTenantId") REFERENCES "tenants"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Revoke older lab invitations that cannot be linked to a clinic.
--    Lab-created ADMIN invitations without clinicTenantId were created before
--    #30 (or their clinic was deleted). Onboarding already refuses them; this
--    marks them revoked so they read as such everywhere. Labs regenerate a new
--    link from the client page. All data before November 2026 is test data, so
--    no backfill is attempted. Platform invitations (laboratoryId NULL) are
--    not touched.
UPDATE "onboarding_tokens"
SET "revokedAt" = now()
WHERE "type" = 'ADMIN'
  AND "laboratoryId" IS NOT NULL
  AND "clinicTenantId" IS NULL
  AND "used" = false
  AND "revokedAt" IS NULL;
