/*
  Warnings:

  - You are about to drop the column `selectedTests` on the `cases` table. All the data in the column will be lost.
  - You are about to drop the column `suggestedTests` on the `cases` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "CatalogItemKind" AS ENUM ('TEST', 'PACKAGE');

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('NUMERIC', 'TEXT', 'POSITIVE_NEGATIVE');

-- AlterTable
ALTER TABLE "cases" DROP COLUMN "selectedTests",
DROP COLUMN "suggestedTests",
ADD COLUMN     "suggestedCatalogItemIds" TEXT[];

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "CatalogItemKind" NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "turnaroundHours" INTEGER,
    "resultType" "ResultType",
    "unit" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_item_compositions" (
    "packageId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,

    CONSTRAINT "catalog_item_compositions_pkey" PRIMARY KEY ("packageId","componentId")
);

-- CreateTable
CREATE TABLE "case_catalog_items" (
    "caseId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,

    CONSTRAINT "case_catalog_items_pkey" PRIMARY KEY ("caseId","catalogItemId")
);

-- CreateIndex
CREATE INDEX "catalog_items_tenantId_idx" ON "catalog_items"("tenantId");

-- CreateIndex
CREATE INDEX "catalog_items_tenantId_kind_idx" ON "catalog_items"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_tenantId_code_key" ON "catalog_items"("tenantId", "code");

-- CreateIndex
CREATE INDEX "case_catalog_items_caseId_idx" ON "case_catalog_items"("caseId");

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_item_compositions" ADD CONSTRAINT "catalog_item_compositions_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_item_compositions" ADD CONSTRAINT "catalog_item_compositions_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_catalog_items" ADD CONSTRAINT "case_catalog_items_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_catalog_items" ADD CONSTRAINT "case_catalog_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
