ALTER TABLE "result_report_release_artifacts"
  ADD COLUMN "claimed_at" TIMESTAMP(3),
  ADD COLUMN "claim_token" TEXT,
  ADD COLUMN "logo_storage_path" TEXT,
  ADD COLUMN "signer_signature_storage_path" TEXT,
  ADD COLUMN "analyst_signature_storage_path" TEXT;
