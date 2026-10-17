-- Tubes no longer needed (their order, or every test waiting for them, was
-- cancelled) are closed as CANCELLED instead of staying EXPECTED/MISSING
-- forever; cancelling an order now leaves an ORDER_CANCELLED timeline entry.
-- Enum additions only — no data change, no backfill.
ALTER TYPE "TimelineEventType" ADD VALUE 'ORDER_CANCELLED';
ALTER TYPE "SpecimenStatus" ADD VALUE 'CANCELLED';
