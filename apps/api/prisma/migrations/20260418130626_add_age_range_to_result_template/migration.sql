/*
  Warnings:

  - A unique constraint covering the columns `[catalogItemId,species,ageMinWeeks,ageMaxWeeks]` on the table `result_templates` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "result_templates_catalogItemId_species_key";

-- AlterTable
ALTER TABLE "result_templates" ADD COLUMN     "ageMaxWeeks" INTEGER,
ADD COLUMN     "ageMinWeeks" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "result_templates_catalogItemId_species_ageMinWeeks_ageMaxWe_key" ON "result_templates"("catalogItemId", "species", "ageMinWeeks", "ageMaxWeeks");
