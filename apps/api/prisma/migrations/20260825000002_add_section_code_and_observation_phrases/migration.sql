-- Add stable code to sections for phrase scoping
ALTER TABLE "result_template_sections" ADD COLUMN "code" TEXT;

-- Add observation phrases JSON to template versions
ALTER TABLE "result_template_versions" ADD COLUMN "observationPhrases" JSONB;

-- Unique constraint: no two sections in the same version share a code.
-- PostgreSQL allows multiple NULLs (SQL standard), so legacy sections are safe.
CREATE UNIQUE INDEX "result_template_sections_versionId_code_key"
  ON "result_template_sections" ("versionId", "code");
