-- AlterTable: make catalogItemId nullable on ordered_tests
ALTER TABLE "ordered_tests" ALTER COLUMN "catalogItemId" DROP NOT NULL;

-- DropForeignKey: remove the old RESTRICT constraint
ALTER TABLE "ordered_tests" DROP CONSTRAINT "ordered_tests_catalogItemId_fkey";

-- AddForeignKey: re-add with ON DELETE SET NULL
ALTER TABLE "ordered_tests" ADD CONSTRAINT "ordered_tests_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey: remove RESTRICT on lab_test_configurations -> catalog_items
ALTER TABLE "lab_test_configurations" DROP CONSTRAINT "lab_test_configurations_catalogItemId_fkey";

-- AddForeignKey: re-add with ON DELETE CASCADE
ALTER TABLE "lab_test_configurations" ADD CONSTRAINT "lab_test_configurations_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
