/*
  Warnings:

  - You are about to drop the column `tenantId` on the `catalog_items` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[code]` on the table `catalog_items` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_items_tenantId_fkey";

-- DropIndex
DROP INDEX "catalog_items_tenantId_code_key";

-- DropIndex
DROP INDEX "catalog_items_tenantId_idx";

-- DropIndex
DROP INDEX "catalog_items_tenantId_kind_idx";

-- AlterTable
ALTER TABLE "catalog_items" DROP COLUMN "tenantId";

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_code_key" ON "catalog_items"("code");

-- CreateIndex
CREATE INDEX "catalog_items_kind_idx" ON "catalog_items"("kind");
