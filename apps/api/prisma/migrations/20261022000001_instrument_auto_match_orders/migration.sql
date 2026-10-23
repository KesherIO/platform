-- Automatic matching of analyzer results by the order's analyzer number
-- (REQ-2026-000012 -> 26000012, derived from the requisition number, never stored).
-- Additive only: a per-analyzer switch, OFF for every existing analyzer, and how each
-- message was matched, for traceability.

-- AlterTable
ALTER TABLE "analyzers" ADD COLUMN "autoMatchOrders" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "instrument_messages" ADD COLUMN "matchedBy" TEXT;
