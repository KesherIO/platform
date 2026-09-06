-- AlterTable
ALTER TABLE "result_report_releases"
    ADD COLUMN "orderingVetId" TEXT,
    ADD COLUMN "orderingVetName" TEXT,
    ADD COLUMN "orderingVetLicenseNumber" TEXT,
    ADD COLUMN "orderingVetIssuingAuthority" TEXT;
