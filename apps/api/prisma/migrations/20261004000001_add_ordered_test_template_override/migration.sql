-- Template picked by hand for a test that had no matching template
ALTER TABLE "ordered_tests"
  ADD COLUMN "templateDefinitionId" TEXT;

ALTER TABLE "ordered_tests"
  ADD CONSTRAINT "ordered_tests_templateDefinitionId_fkey"
  FOREIGN KEY ("templateDefinitionId") REFERENCES "result_template_definitions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
