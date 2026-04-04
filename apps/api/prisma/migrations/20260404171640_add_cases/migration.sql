-- CreateEnum
CREATE TYPE "PatientSpecies" AS ENUM ('DOG', 'CAT', 'EQUINE', 'BOVINE', 'BIRD', 'REPTILE', 'RABBIT', 'OTHER');

-- CreateEnum
CREATE TYPE "AgeUnit" AS ENUM ('DAYS', 'WEEKS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'TRIAGED', 'ORDERED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "patientName" TEXT NOT NULL,
    "patientSpecies" "PatientSpecies" NOT NULL,
    "patientBreed" TEXT,
    "patientAge" INTEGER,
    "patientAgeUnit" "AgeUnit",
    "patientWeight" DOUBLE PRECISION,
    "ownerName" TEXT NOT NULL,
    "ownerPhone" TEXT,
    "symptoms" TEXT,
    "triageResult" JSONB,
    "suggestedTests" JSONB,
    "selectedTests" JSONB,
    "orderNotes" TEXT,
    "orderSentAt" TIMESTAMP(3),
    "resultsUrl" TEXT,
    "resultsReceivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cases_tenantId_idx" ON "cases"("tenantId");

-- CreateIndex
CREATE INDEX "cases_tenantId_status_idx" ON "cases"("tenantId", "status");

-- CreateIndex
CREATE INDEX "cases_tenantId_createdAt_idx" ON "cases"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "cases_createdByUserId_idx" ON "cases"("createdByUserId");

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
