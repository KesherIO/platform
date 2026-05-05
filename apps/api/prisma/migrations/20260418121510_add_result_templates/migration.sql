/*
  Warnings:

  - You are about to drop the column `resultsReceivedAt` on the `cases` table. All the data in the column will be lost.
  - You are about to drop the column `resultsUrl` on the `cases` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "AnalyteValueType" AS ENUM ('NUMERIC', 'TEXT', 'POSITIVE_NEGATIVE', 'SELECT');

-- CreateEnum
CREATE TYPE "ResultReportStatus" AS ENUM ('DRAFT', 'RELEASED');

-- AlterTable
ALTER TABLE "cases" DROP COLUMN "resultsReceivedAt",
DROP COLUMN "resultsUrl";

-- CreateTable
CREATE TABLE "result_templates" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "species" "PatientSpecies" NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultObservations" TEXT,

    CONSTRAINT "result_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_template_sections" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "result_template_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_template_analytes" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sectionId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "technique" TEXT,
    "valueType" "AnalyteValueType" NOT NULL,
    "unit" TEXT,
    "options" TEXT[],
    "sortOrder" INTEGER NOT NULL,
    "isHeader" BOOLEAN NOT NULL DEFAULT false,
    "referenceRange" JSONB,

    CONSTRAINT "result_template_analytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_reports" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "ResultReportStatus" NOT NULL DEFAULT 'DRAFT',
    "observations" TEXT,
    "processedByName" TEXT,
    "processedByRole" TEXT,
    "approvedByName" TEXT,
    "approvedByRole" TEXT,
    "signatureUrl" TEXT,
    "rawPayload" JSONB,
    "pdfUrl" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_report_analytes" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "templateAnalyteId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "technique" TEXT,
    "unit" TEXT,
    "valueType" "AnalyteValueType" NOT NULL,
    "sectionName" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "isHeader" BOOLEAN NOT NULL DEFAULT false,
    "numericValue" DOUBLE PRECISION,
    "textValue" TEXT,
    "booleanValue" BOOLEAN,
    "selectValue" TEXT,
    "flag" TEXT,
    "referenceSnapshot" JSONB,

    CONSTRAINT "result_report_analytes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "result_templates_catalogItemId_species_key" ON "result_templates"("catalogItemId", "species");

-- CreateIndex
CREATE UNIQUE INDEX "result_reports_orderId_key" ON "result_reports"("orderId");

-- CreateIndex
CREATE INDEX "result_reports_caseId_idx" ON "result_reports"("caseId");

-- CreateIndex
CREATE INDEX "result_reports_tenantId_status_idx" ON "result_reports"("tenantId", "status");

-- CreateIndex
CREATE INDEX "result_report_analytes_reportId_idx" ON "result_report_analytes"("reportId");

-- AddForeignKey
ALTER TABLE "result_templates" ADD CONSTRAINT "result_templates_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_template_sections" ADD CONSTRAINT "result_template_sections_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "result_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_template_analytes" ADD CONSTRAINT "result_template_analytes_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "result_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_template_analytes" ADD CONSTRAINT "result_template_analytes_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "result_template_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_reports" ADD CONSTRAINT "result_reports_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_report_analytes" ADD CONSTRAINT "result_report_analytes_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "result_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_report_analytes" ADD CONSTRAINT "result_report_analytes_templateAnalyteId_fkey" FOREIGN KEY ("templateAnalyteId") REFERENCES "result_template_analytes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
