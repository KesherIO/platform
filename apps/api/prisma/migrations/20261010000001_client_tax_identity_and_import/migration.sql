-- Client bulk import, phase 1 (docs/CLIENT_BULK_IMPORT_PLAN.md B1).
-- Nullable columns only — safe for existing rows.

-- 1. Tax identity on the shared clinic profile
ALTER TABLE "tenants"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "taxIdType" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "taxIdNormalized" TEXT;

CREATE INDEX "tenants_country_taxIdType_taxIdNormalized_idx"
  ON "tenants"("country", "taxIdType", "taxIdNormalized");

-- 2. Lab-private notes and import identity on the lab connection
ALTER TABLE "clinic_lab_connections"
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "importBatchId" TEXT,
  ADD COLUMN "importRowNumber" INTEGER,
  ADD COLUMN "importRowHash" TEXT;

-- Postgres treats NULLs as distinct, so connections created by Add client
-- (all three NULL) never collide.
CREATE UNIQUE INDEX "clinic_lab_connections_labId_importBatchId_importRowNumber_key"
  ON "clinic_lab_connections"("labId", "importBatchId", "importRowNumber");
