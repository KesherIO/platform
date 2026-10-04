-- Lab contact details shown in the PDF footer, frozen at release time
ALTER TABLE "result_report_releases"
  ADD COLUMN "labCity" TEXT,
  ADD COLUMN "labPhoneNumbers" JSONB,
  ADD COLUMN "labEmail" TEXT;
