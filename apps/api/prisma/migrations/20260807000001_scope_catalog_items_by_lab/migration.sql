-- Scope CatalogItem by lab: each lab now owns its own catalog, isolated from
-- other labs. Before this migration, catalog_items had no tenant scoping at
-- all (one global table shared by every lab and clinic on the platform).

-- Step 1: add the column nullable first — 39 existing rows need a value
-- before it can become required.
ALTER TABLE "catalog_items" ADD COLUMN "labTenantId" TEXT;

-- Step 2: backfill. Only one LAB-type tenant exists today (confirmed via
-- read-only query before writing this migration), so this is unambiguous.
UPDATE "catalog_items"
SET "labTenantId" = (SELECT id FROM "tenants" WHERE type = 'LAB' LIMIT 1)
WHERE "labTenantId" IS NULL;

-- Step 3: now safe to require it.
ALTER TABLE "catalog_items" ALTER COLUMN "labTenantId" SET NOT NULL;

-- Step 4: foreign key + index.
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_labTenantId_fkey"
  FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "catalog_items_labTenantId_idx" ON "catalog_items"("labTenantId");

-- Step 5: code was globally unique; it only needs to be unique within a
-- lab's own catalog now (two labs may reuse the same short code).
DROP INDEX "catalog_items_code_key";

CREATE UNIQUE INDEX "catalog_items_labTenantId_code_key"
  ON "catalog_items"("labTenantId", "code");
