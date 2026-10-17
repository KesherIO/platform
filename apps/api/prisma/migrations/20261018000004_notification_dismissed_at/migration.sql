-- Recipients can clear notifications from their inbox (one or all). Cleared
-- rows stay as a record of what was sent; they're just no longer listed.
-- Nullable column, no backfill.
ALTER TABLE "notifications" ADD COLUMN "dismissedAt" TIMESTAMP(3);
