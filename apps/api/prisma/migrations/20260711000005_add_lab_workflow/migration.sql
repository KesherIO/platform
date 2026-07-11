-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('CLINIC', 'LAB', 'BIOMET');

-- CreateEnum
CREATE TYPE "OrderedTestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResultEntryMethod" AS ENUM ('MANUAL', 'INSTRUMENT', 'IMPORTED');

-- AlterTable: add tenant type (default CLINIC so all existing rows stay correct)
ALTER TABLE "tenants" ADD COLUMN "type" "TenantType" NOT NULL DEFAULT 'CLINIC';

-- AlterTable: add optional lab tenant FK to orders
ALTER TABLE "orders" ADD COLUMN "labTenantId" TEXT;

-- AlterTable: link result report analytes back to the specific ordered test
ALTER TABLE "result_report_analytes" ADD COLUMN "orderedTestId" TEXT;

-- CreateTable: lab-specific settings per lab/Biomet tenant
CREATE TABLE "laboratory_profiles" (
    "id"                  TEXT NOT NULL,
    "tenantId"            TEXT NOT NULL,
    "accreditationNumber" TEXT,
    "directorName"        TEXT,
    "directorCredentials" TEXT,
    "signatureUrl"        TEXT,
    "defaultObservations" TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "laboratory_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "laboratory_profiles_tenantId_key" ON "laboratory_profiles"("tenantId");

-- CreateTable: explicit clinic ↔ lab connections
CREATE TABLE "clinic_lab_connections" (
    "id"        TEXT NOT NULL,
    "clinicId"  TEXT NOT NULL,
    "labId"     TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_lab_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_lab_connections_clinicId_labId_key" ON "clinic_lab_connections"("clinicId", "labId");

-- CreateIndex
CREATE INDEX "clinic_lab_connections_clinicId_idx" ON "clinic_lab_connections"("clinicId");

-- CreateIndex
CREATE INDEX "clinic_lab_connections_labId_idx" ON "clinic_lab_connections"("labId");

-- CreateTable: one row per catalog item requested in an order
CREATE TABLE "ordered_tests" (
    "id"              TEXT NOT NULL,
    "orderId"         TEXT NOT NULL,
    "catalogItemId"   TEXT NOT NULL,
    "status"          "OrderedTestStatus" NOT NULL DEFAULT 'PENDING',
    "entryMethod"     "ResultEntryMethod" NOT NULL DEFAULT 'MANUAL',
    "catalogItemCode" TEXT,
    "catalogItemName" TEXT NOT NULL,
    "assignedUserId"  TEXT,
    "instrumentId"    TEXT,
    "startedAt"       TIMESTAMP(3),
    "completedAt"     TIMESTAMP(3),
    "cancelledAt"     TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ordered_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ordered_tests_orderId_idx"        ON "ordered_tests"("orderId");
CREATE INDEX "ordered_tests_catalogItemId_idx"   ON "ordered_tests"("catalogItemId");
CREATE INDEX "ordered_tests_assignedUserId_idx"  ON "ordered_tests"("assignedUserId");

-- CreateIndex on orders for lab tenant queries
CREATE INDEX "orders_labTenantId_idx"        ON "orders"("labTenantId");
CREATE INDEX "orders_labTenantId_status_idx" ON "orders"("labTenantId", "status");

-- CreateIndex on result_report_analytes for ordered test lookup
CREATE INDEX "result_report_analytes_orderedTestId_idx" ON "result_report_analytes"("orderedTestId");

-- AddForeignKey: laboratory_profiles → tenants
ALTER TABLE "laboratory_profiles" ADD CONSTRAINT "laboratory_profiles_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: clinic_lab_connections → tenants (clinic side)
ALTER TABLE "clinic_lab_connections" ADD CONSTRAINT "clinic_lab_connections_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: clinic_lab_connections → tenants (lab side)
ALTER TABLE "clinic_lab_connections" ADD CONSTRAINT "clinic_lab_connections_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ordered_tests → orders
ALTER TABLE "ordered_tests" ADD CONSTRAINT "ordered_tests_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ordered_tests → catalog_items
ALTER TABLE "ordered_tests" ADD CONSTRAINT "ordered_tests_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ordered_tests → users (optional assignment)
ALTER TABLE "ordered_tests" ADD CONSTRAINT "ordered_tests_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: orders → tenants (lab side)
ALTER TABLE "orders" ADD CONSTRAINT "orders_labTenantId_fkey"
    FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: result_report_analytes → ordered_tests
ALTER TABLE "result_report_analytes" ADD CONSTRAINT "result_report_analytes_orderedTestId_fkey"
    FOREIGN KEY ("orderedTestId") REFERENCES "ordered_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
