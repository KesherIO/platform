-- AlterTable
ALTER TABLE "cases" ADD COLUMN "attendingVetId" TEXT;

-- AlterTable
ALTER TABLE "orders"
    ADD COLUMN "orderingVetId" TEXT,
    ADD COLUMN "orderingVetName" TEXT,
    ADD COLUMN "orderingVetLicenseNumber" TEXT,
    ADD COLUMN "orderingVetIssuingAuthority" TEXT;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_attendingVetId_fkey" FOREIGN KEY ("attendingVetId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_orderingVetId_fkey" FOREIGN KEY ("orderingVetId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
