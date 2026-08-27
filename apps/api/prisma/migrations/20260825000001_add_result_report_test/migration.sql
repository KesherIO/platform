-- Phase 5a: Introduce ResultReportTest entity between ResultReport and ResultReportAnalyte
-- Three-phase migration: additive → backfill → destructive

-- ============================================================================
-- Phase 1: ADDITIVE — create new table and nullable column
-- ============================================================================

-- Create the result_report_tests table
CREATE TABLE "result_report_tests" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "orderedTestId" TEXT,
    "templateVersionId" TEXT NOT NULL,
    "templateDefinitionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_report_tests_pkey" PRIMARY KEY ("id")
);

-- Add nullable reportTestId to analytes (will be made NOT NULL after backfill)
ALTER TABLE "result_report_analytes" ADD COLUMN "reportTestId" TEXT;

-- Indexes on result_report_tests
CREATE INDEX "result_report_tests_reportId_idx" ON "result_report_tests"("reportId");
CREATE INDEX "result_report_tests_orderedTestId_idx" ON "result_report_tests"("orderedTestId");
CREATE UNIQUE INDEX "result_report_tests_reportId_orderedTestId_key" ON "result_report_tests"("reportId", "orderedTestId");

-- Foreign keys on result_report_tests
ALTER TABLE "result_report_tests" ADD CONSTRAINT "result_report_tests_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "result_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "result_report_tests" ADD CONSTRAINT "result_report_tests_orderedTestId_fkey" FOREIGN KEY ("orderedTestId") REFERENCES "ordered_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "result_report_tests" ADD CONSTRAINT "result_report_tests_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "result_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_report_tests" ADD CONSTRAINT "result_report_tests_templateDefinitionId_fkey" FOREIGN KEY ("templateDefinitionId") REFERENCES "result_template_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 2: BACKFILL — create ResultReportTest rows from existing analyte data
-- ============================================================================

-- For each distinct (reportId, orderedTestId) pair in result_report_analytes,
-- create a ResultReportTest row. Use the report's templateId to find the version
-- and definition.
INSERT INTO "result_report_tests" ("id", "reportId", "orderedTestId", "templateVersionId", "templateDefinitionId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  groups."reportId",
  groups."orderedTestId",
  COALESCE(rr."templateId", 'UNKNOWN_VERSION'),
  COALESCE(rtv."definitionId", 'UNKNOWN_DEFINITION'),
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT "reportId", "orderedTestId"
  FROM "result_report_analytes"
) groups
JOIN "result_reports" rr ON rr."id" = groups."reportId"
LEFT JOIN "result_template_versions" rtv ON rtv."id" = rr."templateId";

-- Point all existing analytes to their new ResultReportTest
UPDATE "result_report_analytes" rra
SET "reportTestId" = rrt."id"
FROM "result_report_tests" rrt
WHERE rrt."reportId" = rra."reportId"
  AND (rrt."orderedTestId" IS NOT DISTINCT FROM rra."orderedTestId");

-- Safety assertion: fail if any analyte was not backfilled
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "result_report_analytes" WHERE "reportTestId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: found result_report_analytes rows with NULL reportTestId';
  END IF;
END $$;

-- ============================================================================
-- Phase 3: DESTRUCTIVE — make reportTestId NOT NULL, drop old columns
-- ============================================================================

-- Make reportTestId non-nullable now that backfill is verified
ALTER TABLE "result_report_analytes" ALTER COLUMN "reportTestId" SET NOT NULL;

-- Add FK constraint for reportTestId
ALTER TABLE "result_report_analytes" ADD CONSTRAINT "result_report_analytes_reportTestId_fkey" FOREIGN KEY ("reportTestId") REFERENCES "result_report_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create index for the new FK
CREATE INDEX "result_report_analytes_reportTestId_idx" ON "result_report_analytes"("reportTestId");

-- Drop RLS policy that depends on reportId before dropping the column
DROP POLICY IF EXISTS "result_report_analytes: select via parent report" ON "result_report_analytes";

-- Drop old FK constraints from result_report_analytes
ALTER TABLE "result_report_analytes" DROP CONSTRAINT IF EXISTS "result_report_analytes_reportId_fkey";
ALTER TABLE "result_report_analytes" DROP CONSTRAINT IF EXISTS "result_report_analytes_orderedTestId_fkey";

-- Drop old indexes
DROP INDEX IF EXISTS "result_report_analytes_reportId_idx";
DROP INDEX IF EXISTS "result_report_analytes_orderedTestId_idx";

-- Drop old columns from result_report_analytes
ALTER TABLE "result_report_analytes" DROP COLUMN "reportId";
ALTER TABLE "result_report_analytes" DROP COLUMN "orderedTestId";

-- Drop templateId from result_reports (provenance now on result_report_tests)
ALTER TABLE "result_reports" DROP COLUMN "templateId";

-- ============================================================================
-- Phase 4: RLS — add policy for new table, recreate analytes policy via new path
-- ============================================================================

-- RLS for result_report_tests — tenant-scoped via parent report
ALTER TABLE public.result_report_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_report_tests FORCE ROW LEVEL SECURITY;

CREATE POLICY "result_report_tests: select via parent report"
  ON public.result_report_tests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.result_reports r
      WHERE r.id = "reportId"
        AND auth.role() = 'authenticated'
    )
  );

-- Recreate analytes policy using new reportTestId → report_tests → reports path
CREATE POLICY "result_report_analytes: select via parent report"
  ON public.result_report_analytes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.result_report_tests rt
      JOIN public.result_reports r ON r.id = rt."reportId"
      WHERE rt.id = "reportTestId"
        AND auth.role() = 'authenticated'
    )
  );
