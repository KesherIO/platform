-- Client status and sample-collection settings become per lab: one lab
-- suspending a clinic must not affect the clinic's other labs. Each existing
-- connection gets the clinic's current values, so behavior is unchanged.
-- The tenants columns stay (unused) and are dropped in a later migration.
ALTER TABLE "clinic_lab_connections"
  ADD COLUMN "status" "ClientStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "pickupEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "defaultDeliveryMethod" "DeliveryMethod",
  ADD COLUMN "pickupAddress" TEXT,
  ADD COLUMN "pickupContactName" TEXT,
  ADD COLUMN "pickupContactPhone" TEXT,
  ADD COLUMN "collectionHours" TEXT,
  ADD COLUMN "pickupInstructions" TEXT;

UPDATE "clinic_lab_connections" AS c
SET
  "status" = COALESCE(t."clientStatus", 'PENDING'),
  "pickupEnabled" = t."pickupEnabled",
  "defaultDeliveryMethod" = t."defaultDeliveryMethod",
  "pickupAddress" = t."pickupAddress",
  "pickupContactName" = t."pickupContactName",
  "pickupContactPhone" = t."pickupContactPhone",
  "collectionHours" = t."collectionHours",
  "pickupInstructions" = t."pickupInstructions"
FROM "tenants" AS t
WHERE t."id" = c."clinicId";
