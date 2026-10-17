-- The PDF header shows the lab's logo on the right, next to the clinic's on
-- the left. Snapshotted per artifact like the clinic logo; existing PDFs keep
-- their old header, so no backfill.
ALTER TABLE "result_report_release_artifacts"
  ADD COLUMN "lab_logo_storage_path" TEXT;
