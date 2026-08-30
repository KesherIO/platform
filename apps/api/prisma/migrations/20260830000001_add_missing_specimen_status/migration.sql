-- AlterEnum: Add MISSING to SpecimenStatus
ALTER TYPE "SpecimenStatus" ADD VALUE 'MISSING';

-- AlterEnum: Add specimen-missing timeline event types
ALTER TYPE "TimelineEventType" ADD VALUE 'SPECIMEN_MISSING';
ALTER TYPE "TimelineEventType" ADD VALUE 'SPECIMEN_MISSING_REVERSED';

-- AlterTable: Add markedMissing fields to specimens
ALTER TABLE "specimens" ADD COLUMN "markedMissingAt" TIMESTAMP(3);
ALTER TABLE "specimens" ADD COLUMN "markedMissingById" TEXT;

-- AddForeignKey
ALTER TABLE "specimens" ADD CONSTRAINT "specimens_markedMissingById_fkey"
    FOREIGN KEY ("markedMissingById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
