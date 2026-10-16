-- Indexes for the Resultados search (docs/RESULTS_SEARCH_PLAN.md rev. 2).
-- Indexes only, no data change. Released results are searched per lab by
-- release date (optionally per clinic) and by analyte code; "current version"
-- joins result_report_tests on latestReleaseId; in-progress orders are listed
-- per lab by order date.

CREATE INDEX "result_report_releases_labTenantId_releasedAt_idx"
  ON "result_report_releases"("labTenantId", "releasedAt");

CREATE INDEX "result_report_releases_labTenantId_clinicTenantId_releasedA_idx"
  ON "result_report_releases"("labTenantId", "clinicTenantId", "releasedAt");

CREATE INDEX "result_report_release_analytes_code_idx"
  ON "result_report_release_analytes"("code");

CREATE INDEX "result_report_tests_latestReleaseId_idx"
  ON "result_report_tests"("latestReleaseId");

CREATE INDEX "orders_labTenantId_createdAt_idx"
  ON "orders"("labTenantId", "createdAt");
