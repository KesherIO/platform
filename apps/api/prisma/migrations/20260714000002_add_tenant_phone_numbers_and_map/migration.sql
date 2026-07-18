-- Add phoneNumbers (JSON), mapLat, mapLng to tenants
ALTER TABLE "tenants" ADD COLUMN "phoneNumbers" JSONB;
ALTER TABLE "tenants" ADD COLUMN "mapLat" DOUBLE PRECISION;
ALTER TABLE "tenants" ADD COLUMN "mapLng" DOUBLE PRECISION;
