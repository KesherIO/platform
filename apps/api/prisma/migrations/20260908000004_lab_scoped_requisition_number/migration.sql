-- DropIndex: remove global unique on requisitionNumber
DROP INDEX IF EXISTS "orders_requisitionNumber_key";

-- CreateIndex: lab-scoped unique (composite — only applies when labTenantId IS NOT NULL)
CREATE UNIQUE INDEX "orders_labTenantId_requisitionNumber_key"
    ON "orders"("labTenantId", "requisitionNumber");

-- CreateIndex: partial unique for NULL labTenantId (PostgreSQL composite unique
-- treats NULLs as distinct, so this index fills the gap for legacy/seed orders)
CREATE UNIQUE INDEX "orders_requisitionNumber_null_lab_key"
    ON "orders"("requisitionNumber")
    WHERE "labTenantId" IS NULL;
