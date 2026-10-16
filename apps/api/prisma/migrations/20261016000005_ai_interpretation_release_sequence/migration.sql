-- Release sequence an AI interpretation was built from, so an amendment
-- approved later marks it stale (the clinic gets the Interpret button again).
ALTER TABLE "ai_interpretations" ADD COLUMN "builtFromReleaseSequence" INTEGER;
