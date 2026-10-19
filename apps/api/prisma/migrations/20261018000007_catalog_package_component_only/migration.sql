-- Tests that exist only as parts of a package (e.g. one sample of a serial
-- coprologico) can be hidden from clinics. Defaults to false, so every
-- existing item stays visible exactly as before; no backfill.
ALTER TABLE "catalog_items" ADD COLUMN "packageComponentOnly" BOOLEAN NOT NULL DEFAULT false;
