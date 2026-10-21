-- A vet can ask for a pickup at a one-off address (e.g. a house call) instead
-- of the clinic's usual collection point. The address/contact columns already
-- hold the location; these two record that it is an alternate one and any
-- access notes. Existing pickups default to false / NULL.
ALTER TABLE "pickups" ADD COLUMN "isAlternateLocation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pickups" ADD COLUMN "pickupLocationNotes" TEXT;
