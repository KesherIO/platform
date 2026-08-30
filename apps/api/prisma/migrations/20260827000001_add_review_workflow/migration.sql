-- Phase 6: Review workflow
-- Adds IN_REVIEW status, reviewer fields, and timeline event types

-- 1. Add IN_REVIEW to ResultReportStatus enum
ALTER TYPE "ResultReportStatus" ADD VALUE IF NOT EXISTS 'IN_REVIEW' BEFORE 'RELEASED';

-- 2. Add new timeline event types
ALTER TYPE "TimelineEventType" ADD VALUE IF NOT EXISTS 'SUBMITTED_FOR_REVIEW';
ALTER TYPE "TimelineEventType" ADD VALUE IF NOT EXISTS 'REVIEW_APPROVED';
ALTER TYPE "TimelineEventType" ADD VALUE IF NOT EXISTS 'REVIEW_CORRECTIONS';

-- 3. Add review columns to result_reports
ALTER TABLE "result_reports" ADD COLUMN "submittedForReviewAt" TIMESTAMP(3);
ALTER TABLE "result_reports" ADD COLUMN "submittedByUserId" TEXT;
ALTER TABLE "result_reports" ADD COLUMN "reviewedBySignerId" TEXT;
ALTER TABLE "result_reports" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "result_reports" ADD COLUMN "reviewNotes" TEXT;
ALTER TABLE "result_reports" ADD COLUMN "correctionNotes" TEXT;

-- 4. FK from result_reports to lab_signers
ALTER TABLE "result_reports" ADD CONSTRAINT "result_reports_reviewedBySignerId_fkey"
  FOREIGN KEY ("reviewedBySignerId") REFERENCES "lab_signers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
