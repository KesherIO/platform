-- Lab billing codes + billing export history.
-- billingCode is nullable with no backfill: existing catalog items, orders and
-- templates are untouched. Postgres treats NULLs as distinct in a unique index,
-- so unmapped items don't collide; a code is unique within one lab.

-- AlterTable
ALTER TABLE "catalog_items" ADD COLUMN "billingCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_labTenantId_billingCode_key" ON "catalog_items"("labTenantId", "billingCode");

-- CreateTable
CREATE TABLE "billing_exports" (
    "id" TEXT NOT NULL,
    "labTenantId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "dateFrom" TEXT NOT NULL,
    "dateTo" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "onlyNew" BOOLEAN NOT NULL DEFAULT false,
    "lineCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_export_lines" (
    "id" TEXT NOT NULL,
    "exportId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "patientName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "billing_export_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_deleted_item_codes" (
    "id" TEXT NOT NULL,
    "labTenantId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "billingCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "internalCode" TEXT,
    "assignedByUserId" TEXT NOT NULL,
    "assignedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_deleted_item_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_deleted_item_codes_labTenantId_catalogItemId_key" ON "billing_deleted_item_codes"("labTenantId", "catalogItemId");

-- CreateIndex
CREATE INDEX "billing_exports_labTenantId_createdAt_idx" ON "billing_exports"("labTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "billing_export_lines_exportId_position_idx" ON "billing_export_lines"("exportId", "position");

-- CreateIndex
CREATE INDEX "billing_export_lines_orderId_lineKey_idx" ON "billing_export_lines"("orderId", "lineKey");

-- AddForeignKey
ALTER TABLE "billing_exports" ADD CONSTRAINT "billing_exports_labTenantId_fkey" FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_export_lines" ADD CONSTRAINT "billing_export_lines_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "billing_exports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_deleted_item_codes" ADD CONSTRAINT "billing_deleted_item_codes_labTenantId_fkey" FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data API lockdown (docs/SECURITY_LOCKDOWN.md): RLS on, no policies — only
-- the API's own connection reads these tables.
ALTER TABLE "billing_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_export_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_deleted_item_codes" ENABLE ROW LEVEL SECURITY;
