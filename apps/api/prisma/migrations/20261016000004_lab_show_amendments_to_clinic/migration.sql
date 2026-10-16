-- Per-lab choice: show amendments to clinics (default, today's behavior) or
-- keep them silent (clinic only sees the current report).
ALTER TABLE "laboratory_profiles" ADD COLUMN "showAmendmentsToClinic" BOOLEAN NOT NULL DEFAULT true;
