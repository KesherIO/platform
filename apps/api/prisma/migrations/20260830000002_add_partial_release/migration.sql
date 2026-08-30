-- Partial release: selective release, immutable snapshots, amendment workspace
-- Adds 4 enums, 5 timeline event types, alters 2 tables, creates 6 tables, backfills

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

CREATE TYPE "ReleaseType" AS ENUM ('PARTIAL', 'FINAL', 'AMENDMENT');
CREATE TYPE "AmendmentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'CANCELLED');
CREATE TYPE "ResultReportTestStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'RELEASED');
CREATE TYPE "ReleaseArtifactStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

-- ============================================================================
-- 2. TIMELINE EVENT TYPES
-- ============================================================================

ALTER TYPE "TimelineEventType" ADD VALUE IF NOT EXISTS 'RELEASE_CREATED';
ALTER TYPE "TimelineEventType" ADD VALUE IF NOT EXISTS 'AMENDMENT_INITIATED';
ALTER TYPE "TimelineEventType" ADD VALUE IF NOT EXISTS 'AMENDMENT_SUBMITTED_FOR_REVIEW';
ALTER TYPE "TimelineEventType" ADD VALUE IF NOT EXISTS 'AMENDMENT_APPROVED';
ALTER TYPE "TimelineEventType" ADD VALUE IF NOT EXISTS 'AMENDMENT_CANCELLED';

-- ============================================================================
-- 3. ALTER result_reports — add release sequence counter
-- ============================================================================

ALTER TABLE "result_reports" ADD COLUMN "currentReleaseSequence" INT NOT NULL DEFAULT 0;

-- ============================================================================
-- 4. ALTER result_report_tests — add status + latest release tracking
-- ============================================================================

ALTER TABLE "result_report_tests" ADD COLUMN "status" "ResultReportTestStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "result_report_tests" ADD COLUMN "latestReleaseId" TEXT;
ALTER TABLE "result_report_tests" ADD COLUMN "latestReleasedAt" TIMESTAMP(3);

-- ============================================================================
-- 5. CREATE TABLES (in FK order)
-- ============================================================================

-- 5a. result_report_releases
CREATE TABLE "result_report_releases" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "releaseSequence" INT NOT NULL,
    "releaseType" "ReleaseType" NOT NULL,

    -- Signer snapshot (frozen at release time)
    "signerId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerTitle" TEXT,
    "signerSpecialty" TEXT,
    "signerUniversity" TEXT,
    "signerRegistrationNumber" TEXT,
    "signerSignatureUrl" TEXT,

    -- Released-by actor
    "releasedByUserId" TEXT NOT NULL,
    "releasedByName" TEXT NOT NULL,
    "reviewNotes" TEXT,

    -- Lab identity snapshot
    "labTenantId" TEXT NOT NULL,
    "labName" TEXT NOT NULL,
    "labAccreditationNumber" TEXT,
    "labDirectorName" TEXT,
    "labDirectorCredentials" TEXT,
    "labLogoUrl" TEXT,
    "labAddress" TEXT,
    "labPhone" TEXT,

    -- Order identity snapshot
    "orderId" TEXT NOT NULL,
    "requisitionNumber" TEXT NOT NULL,
    "orderPriority" TEXT NOT NULL,
    "orderClinicNotes" TEXT,
    "orderCreatedAt" TIMESTAMP(3) NOT NULL,

    -- Patient identity snapshot
    "patientName" TEXT NOT NULL,
    "patientSpecies" TEXT NOT NULL,
    "patientSex" TEXT,
    "patientBreed" TEXT,
    "patientAge" INT,
    "patientAgeUnit" TEXT,
    "patientDateOfBirth" TIMESTAMP(3),
    "patientWeight" DOUBLE PRECISION,
    "ownerName" TEXT NOT NULL,
    "ownerPhone" TEXT,

    -- Clinic identity snapshot
    "clinicTenantId" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "clinicAddress" TEXT,
    "clinicPhone" TEXT,
    "clinicLogoUrl" TEXT,

    -- Release-level content
    "observations" TEXT,

    -- Timestamps
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_report_releases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "result_report_releases_reportId_releaseSequence_key"
    ON "result_report_releases"("reportId", "releaseSequence");
CREATE INDEX "result_report_releases_reportId_idx"
    ON "result_report_releases"("reportId");
CREATE INDEX "result_report_releases_orderId_idx"
    ON "result_report_releases"("orderId");

ALTER TABLE "result_report_releases" ADD CONSTRAINT "result_report_releases_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "result_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_report_releases" ADD CONSTRAINT "result_report_releases_signerId_fkey"
    FOREIGN KEY ("signerId") REFERENCES "lab_signers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5b. result_report_release_tests
CREATE TABLE "result_report_release_tests" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,

    -- Traceability FKs
    "sourceReportTestId" TEXT NOT NULL,
    "orderedTestId" TEXT,

    -- Per-test amendment lineage
    "amendsReleaseTestId" TEXT,

    -- Test identity snapshot
    "catalogItemCode" TEXT,
    "catalogItemName" TEXT NOT NULL,
    "department" TEXT,
    "processingMethod" TEXT,
    "entryMethod" TEXT NOT NULL,

    -- Template provenance snapshot
    "templateDefinitionId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "templateTitle" TEXT NOT NULL,
    "templateVersion" INT NOT NULL,

    -- Specimen snapshot
    "specimenAccessionNumbers" TEXT[],
    "specimenTypes" TEXT[],

    -- Test-level content
    "observations" TEXT,
    "conclusion" TEXT,

    -- Result dates
    "resultsEnteredAt" TIMESTAMP(3),
    "testStartedAt" TIMESTAMP(3),
    "testCompletedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_report_release_tests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "result_report_release_tests_releaseId_sourceReportTestId_key"
    ON "result_report_release_tests"("releaseId", "sourceReportTestId");
CREATE INDEX "result_report_release_tests_releaseId_idx"
    ON "result_report_release_tests"("releaseId");
CREATE INDEX "result_report_release_tests_sourceReportTestId_idx"
    ON "result_report_release_tests"("sourceReportTestId");
CREATE INDEX "result_report_release_tests_amendsReleaseTestId_idx"
    ON "result_report_release_tests"("amendsReleaseTestId");

ALTER TABLE "result_report_release_tests" ADD CONSTRAINT "result_report_release_tests_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "result_report_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_report_release_tests" ADD CONSTRAINT "result_report_release_tests_sourceReportTestId_fkey"
    FOREIGN KEY ("sourceReportTestId") REFERENCES "result_report_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_report_release_tests" ADD CONSTRAINT "result_report_release_tests_orderedTestId_fkey"
    FOREIGN KEY ("orderedTestId") REFERENCES "ordered_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "result_report_release_tests" ADD CONSTRAINT "result_report_release_tests_amendsReleaseTestId_fkey"
    FOREIGN KEY ("amendsReleaseTestId") REFERENCES "result_report_release_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_report_release_tests" ADD CONSTRAINT "result_report_release_tests_templateDefinitionId_fkey"
    FOREIGN KEY ("templateDefinitionId") REFERENCES "result_template_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_report_release_tests" ADD CONSTRAINT "result_report_release_tests_templateVersionId_fkey"
    FOREIGN KEY ("templateVersionId") REFERENCES "result_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5c. result_report_release_analytes
CREATE TABLE "result_report_release_analytes" (
    "id" TEXT NOT NULL,
    "releaseTestId" TEXT NOT NULL,

    -- Analyte identity snapshot
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectionName" TEXT,
    "sortOrder" INT NOT NULL,
    "isHeader" BOOLEAN NOT NULL DEFAULT false,

    -- Value snapshot
    "valueType" "AnalyteValueType" NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "textValue" TEXT,
    "booleanValue" BOOLEAN,
    "selectValue" TEXT,

    -- Metadata snapshot
    "unit" TEXT,
    "technique" TEXT,
    "formula" TEXT,

    -- Clinical interpretation snapshot
    "flag" TEXT,
    "referenceSnapshot" JSONB,

    CONSTRAINT "result_report_release_analytes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "result_report_release_analytes_releaseTestId_idx"
    ON "result_report_release_analytes"("releaseTestId");

ALTER TABLE "result_report_release_analytes" ADD CONSTRAINT "result_report_release_analytes_releaseTestId_fkey"
    FOREIGN KEY ("releaseTestId") REFERENCES "result_report_release_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5d. result_report_release_artifacts
CREATE TABLE "result_report_release_artifacts" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL DEFAULT 'PDF',
    "status" "ReleaseArtifactStatus" NOT NULL DEFAULT 'PENDING',
    "storageUrl" TEXT,
    "errorMessage" TEXT,
    "retryCount" INT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_report_release_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "result_report_release_artifacts_releaseId_artifactType_key"
    ON "result_report_release_artifacts"("releaseId", "artifactType");

ALTER TABLE "result_report_release_artifacts" ADD CONSTRAINT "result_report_release_artifacts_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "result_report_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5e. result_report_amendments
CREATE TABLE "result_report_amendments" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reportTestId" TEXT NOT NULL,
    "sourceReleaseId" TEXT NOT NULL,

    "status" "AmendmentStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,

    -- Review fields
    "submittedForReviewAt" TIMESTAMP(3),
    "submittedByUserId" TEXT,
    "reviewedBySignerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,

    -- Outcome
    "resultingReleaseId" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_report_amendments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "result_report_amendments_reportId_idx"
    ON "result_report_amendments"("reportId");
CREATE INDEX "result_report_amendments_reportTestId_idx"
    ON "result_report_amendments"("reportTestId");

ALTER TABLE "result_report_amendments" ADD CONSTRAINT "result_report_amendments_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "result_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_report_amendments" ADD CONSTRAINT "result_report_amendments_reportTestId_fkey"
    FOREIGN KEY ("reportTestId") REFERENCES "result_report_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_report_amendments" ADD CONSTRAINT "result_report_amendments_sourceReleaseId_fkey"
    FOREIGN KEY ("sourceReleaseId") REFERENCES "result_report_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5f. result_report_amendment_analytes
CREATE TABLE "result_report_amendment_analytes" (
    "id" TEXT NOT NULL,
    "amendmentId" TEXT NOT NULL,

    -- Analyte identity (copied from release snapshot)
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectionName" TEXT,
    "sortOrder" INT NOT NULL,
    "isHeader" BOOLEAN NOT NULL DEFAULT false,

    -- Editable value fields
    "valueType" "AnalyteValueType" NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "textValue" TEXT,
    "booleanValue" BOOLEAN,
    "selectValue" TEXT,

    -- Metadata (copied from release snapshot)
    "unit" TEXT,
    "technique" TEXT,
    "formula" TEXT,

    -- Computed on amendment approval
    "flag" TEXT,
    "referenceSnapshot" JSONB,

    CONSTRAINT "result_report_amendment_analytes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "result_report_amendment_analytes_amendmentId_idx"
    ON "result_report_amendment_analytes"("amendmentId");

ALTER TABLE "result_report_amendment_analytes" ADD CONSTRAINT "result_report_amendment_analytes_amendmentId_fkey"
    FOREIGN KEY ("amendmentId") REFERENCES "result_report_amendments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 6. DEFERRED FK — result_report_tests.latestReleaseId → releases
-- ============================================================================

ALTER TABLE "result_report_tests" ADD CONSTRAINT "result_report_tests_latestReleaseId_fkey"
    FOREIGN KEY ("latestReleaseId") REFERENCES "result_report_releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 7. BACKFILL — idempotent (guarded by currentReleaseSequence = 0)
-- ============================================================================

-- 7a. RELEASED reports → create FINAL release (seq=1), snapshot tests + analytes
DO $$
DECLARE
  rpt RECORD;
  release_id TEXT;
  rel_test RECORD;
  rel_test_id TEXT;
  analyte RECORD;
BEGIN
  FOR rpt IN
    SELECT r.id AS report_id,
           r."orderId",
           r."tenantId",
           r."observations",
           r."reviewedBySignerId",
           r."releasedByUserId",
           r."releasedAt",
           r."reviewNotes",
           r."approvedByName"
    FROM "result_reports" r
    WHERE r."status" = 'RELEASED'
      AND r."currentReleaseSequence" = 0
  LOOP
    -- Skip RELEASED reports with no tests (legacy records from before KAN-5)
    IF NOT EXISTS (
      SELECT 1 FROM "result_report_tests" WHERE "reportId" = rpt.report_id
    ) THEN
      RAISE NOTICE 'Skipping RELEASED report % — no result_report_tests (legacy)', rpt.report_id;
      CONTINUE;
    END IF;

    -- Skip RELEASED reports with no signer (legacy records from before KAN-6)
    IF rpt."reviewedBySignerId" IS NULL THEN
      RAISE NOTICE 'Skipping RELEASED report % — no reviewedBySignerId (legacy)', rpt.report_id;
      CONTINUE;
    END IF;

    release_id := gen_random_uuid()::text;

    -- Create the release record with snapshot data from related tables
    INSERT INTO "result_report_releases" (
      "id", "reportId", "releaseSequence", "releaseType",
      "signerId", "signerName", "signerTitle", "signerSpecialty",
      "signerUniversity", "signerRegistrationNumber", "signerSignatureUrl",
      "releasedByUserId", "releasedByName", "reviewNotes",
      "labTenantId", "labName", "labAccreditationNumber",
      "labDirectorName", "labDirectorCredentials", "labLogoUrl",
      "labAddress", "labPhone",
      "orderId", "requisitionNumber", "orderPriority",
      "orderClinicNotes", "orderCreatedAt",
      "patientName", "patientSpecies", "patientSex", "patientBreed",
      "patientAge", "patientAgeUnit", "patientDateOfBirth", "patientWeight",
      "ownerName", "ownerPhone",
      "clinicTenantId", "clinicName", "clinicAddress", "clinicPhone", "clinicLogoUrl",
      "observations", "releasedAt"
    )
    SELECT
      release_id,
      rpt.report_id,
      1,
      'FINAL'::"ReleaseType",
      -- Signer snapshot
      s."id",
      s."name",
      s."title",
      s."specialty",
      s."university",
      s."registrationNumber",
      s."signatureUrl",
      -- Released-by actor
      COALESCE(rpt."releasedByUserId", rpt."reviewedBySignerId"),
      COALESCE(rpt."approvedByName", s."name"),
      rpt."reviewNotes",
      -- Lab snapshot
      lt."id",
      lt."name",
      lp."accreditationNumber",
      lp."directorName",
      lp."directorCredentials",
      lt."logoUrl",
      CONCAT_WS(', ', lt."address", lt."city"),
      lt."phone",
      -- Order snapshot
      o."id",
      o."requisitionNumber",
      o."priority"::text,
      o."clinicNotes",
      o."createdAt",
      -- Patient snapshot
      c."patientName",
      c."patientSpecies"::text,
      c."patientSex"::text,
      c."patientBreed",
      c."patientAge",
      c."patientAgeUnit"::text,
      c."patientDateOfBirth",
      c."patientWeight",
      c."ownerName",
      c."ownerPhone",
      -- Clinic snapshot
      o."tenantId",
      COALESCE(ct."name", 'Unknown Clinic'),
      ct."address",
      ct."phone",
      ct."logoUrl",
      -- Content + timestamp
      rpt."observations",
      COALESCE(rpt."releasedAt", NOW())
    FROM "lab_signers" s
    JOIN "tenants" lt ON lt."id" = rpt."tenantId"
    LEFT JOIN "laboratory_profiles" lp ON lp."tenantId" = rpt."tenantId"
    JOIN "orders" o ON o."id" = rpt."orderId"
    JOIN "cases" c ON c."id" = o."caseId"
    LEFT JOIN "tenants" ct ON ct."id" = o."tenantId"
    WHERE s."id" = rpt."reviewedBySignerId";

    -- Snapshot each test
    FOR rel_test IN
      SELECT rrt."id" AS report_test_id,
             rrt."orderedTestId",
             rrt."templateDefinitionId",
             rrt."templateVersionId",
             rtv."title" AS tpl_title,
             rtv."version" AS tpl_version,
             ot."status" AS ot_status,
             ci."code" AS ci_code,
             ci."name" AS ci_name,
             ot."department"::text AS department,
             ot."processingMethod"::text AS "processingMethod",
             ot."entryMethod"::text AS "entryMethod",
             ot."startedAt" AS test_started_at,
             ot."completedAt" AS test_completed_at
      FROM "result_report_tests" rrt
      JOIN "result_template_versions" rtv ON rtv."id" = rrt."templateVersionId"
      LEFT JOIN "ordered_tests" ot ON ot."id" = rrt."orderedTestId"
      LEFT JOIN "catalog_items" ci ON ci."id" = ot."catalogItemId"
      WHERE rrt."reportId" = rpt.report_id
    LOOP
      rel_test_id := gen_random_uuid()::text;

      INSERT INTO "result_report_release_tests" (
        "id", "releaseId", "sourceReportTestId", "orderedTestId",
        "catalogItemCode", "catalogItemName", "department",
        "processingMethod", "entryMethod",
        "templateDefinitionId", "templateVersionId",
        "templateTitle", "templateVersion",
        "specimenAccessionNumbers", "specimenTypes",
        "testCompletedAt", "testStartedAt"
      )
      VALUES (
        rel_test_id,
        release_id,
        rel_test.report_test_id,
        rel_test."orderedTestId",
        rel_test.ci_code,
        COALESCE(rel_test.ci_name, rel_test.tpl_title, 'Unknown Test'),
        rel_test."department",
        rel_test."processingMethod",
        COALESCE(rel_test."entryMethod", 'MANUAL'),
        rel_test."templateDefinitionId",
        rel_test."templateVersionId",
        COALESCE(rel_test.tpl_title, 'Unknown Template'),
        COALESCE(rel_test.tpl_version, 1),
        ARRAY(
          SELECT sp."accessionNumber" FROM "specimens" sp
          JOIN "ordered_test_specimens" ots ON ots."specimenId" = sp."id"
          WHERE ots."orderedTestId" = rel_test."orderedTestId"
            AND sp."accessionNumber" IS NOT NULL
        ),
        ARRAY(
          SELECT sp."specimenType" FROM "specimens" sp
          JOIN "ordered_test_specimens" ots ON ots."specimenId" = sp."id"
          WHERE ots."orderedTestId" = rel_test."orderedTestId"
            AND sp."specimenType" IS NOT NULL
        ),
        COALESCE(rel_test.test_completed_at, COALESCE(rpt."releasedAt", NOW())),
        rel_test.test_started_at
      );

      -- Snapshot analytes for this test
      INSERT INTO "result_report_release_analytes" (
        "id", "releaseTestId",
        "code", "name", "sectionName", "sortOrder", "isHeader",
        "valueType", "numericValue", "textValue", "booleanValue", "selectValue",
        "unit", "technique", "formula",
        "flag", "referenceSnapshot"
      )
      SELECT
        gen_random_uuid()::text,
        rel_test_id,
        rra."code",
        rra."name",
        rra."sectionName",
        rra."sortOrder",
        rra."isHeader",
        rra."valueType",
        rra."numericValue",
        rra."textValue",
        rra."booleanValue",
        rra."selectValue",
        rra."unit",
        rra."technique",
        rra."formula",
        rra."flag",
        rra."referenceSnapshot"
      FROM "result_report_analytes" rra
      WHERE rra."reportTestId" = rel_test.report_test_id
      ORDER BY rra."sortOrder";

      -- Update the report test to point to this release
      UPDATE "result_report_tests"
      SET "status" = 'RELEASED',
          "latestReleaseId" = release_id,
          "latestReleasedAt" = COALESCE(rpt."releasedAt", NOW())
      WHERE "id" = rel_test.report_test_id;
    END LOOP;

    -- Update the release sequence counter
    UPDATE "result_reports"
    SET "currentReleaseSequence" = 1
    WHERE "id" = rpt.report_id;
  END LOOP;
END $$;

-- 7b. IN_REVIEW reports → set test status to IN_REVIEW
UPDATE "result_report_tests" rrt
SET "status" = 'IN_REVIEW'
FROM "result_reports" r
WHERE r."id" = rrt."reportId"
  AND r."status" = 'IN_REVIEW'
  AND rrt."status" = 'DRAFT';

-- 7c. DRAFT reports → leave default (DRAFT), no action needed

-- 7d. Fix orders stuck in PROCESSING where all tests are COMPLETED/CANCELLED
-- Bug: old ReviewService.approveAndRelease() updated ordered tests to COMPLETED
-- but never called OrderStatusService.deriveAndPersist(), leaving orders stuck.
UPDATE "orders" o
SET "status" = 'COMPLETED',
    "completedAt" = COALESCE(o."completedAt", NOW())
WHERE o."status" = 'PROCESSING'
  AND NOT EXISTS (
    SELECT 1 FROM "ordered_tests" ot
    WHERE ot."orderId" = o."id"
      AND ot."status" NOT IN ('COMPLETED', 'CANCELLED')
  )
  AND EXISTS (
    SELECT 1 FROM "ordered_tests" ot
    WHERE ot."orderId" = o."id"
  );

-- ============================================================================
-- 8. RLS policies for new tables
-- ============================================================================

ALTER TABLE public.result_report_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_report_releases FORCE ROW LEVEL SECURITY;
CREATE POLICY "result_report_releases: select via parent report"
  ON public.result_report_releases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.result_reports r
      WHERE r.id = "reportId"
        AND auth.role() = 'authenticated'
    )
  );

ALTER TABLE public.result_report_release_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_report_release_tests FORCE ROW LEVEL SECURITY;
CREATE POLICY "result_report_release_tests: select via parent release"
  ON public.result_report_release_tests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.result_report_releases rel
      JOIN public.result_reports r ON r.id = rel."reportId"
      WHERE rel.id = "releaseId"
        AND auth.role() = 'authenticated'
    )
  );

ALTER TABLE public.result_report_release_analytes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_report_release_analytes FORCE ROW LEVEL SECURITY;
CREATE POLICY "result_report_release_analytes: select via parent release"
  ON public.result_report_release_analytes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.result_report_release_tests rt
      JOIN public.result_report_releases rel ON rel.id = rt."releaseId"
      JOIN public.result_reports r ON r.id = rel."reportId"
      WHERE rt.id = "releaseTestId"
        AND auth.role() = 'authenticated'
    )
  );

ALTER TABLE public.result_report_release_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_report_release_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY "result_report_release_artifacts: select via parent release"
  ON public.result_report_release_artifacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.result_report_releases rel
      JOIN public.result_reports r ON r.id = rel."reportId"
      WHERE rel.id = "releaseId"
        AND auth.role() = 'authenticated'
    )
  );

ALTER TABLE public.result_report_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_report_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY "result_report_amendments: select via parent report"
  ON public.result_report_amendments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.result_reports r
      WHERE r.id = "reportId"
        AND auth.role() = 'authenticated'
    )
  );

ALTER TABLE public.result_report_amendment_analytes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_report_amendment_analytes FORCE ROW LEVEL SECURITY;
CREATE POLICY "result_report_amendment_analytes: select via parent amendment"
  ON public.result_report_amendment_analytes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.result_report_amendments a
      JOIN public.result_reports r ON r.id = a."reportId"
      WHERE a.id = "amendmentId"
        AND auth.role() = 'authenticated'
    )
  );
