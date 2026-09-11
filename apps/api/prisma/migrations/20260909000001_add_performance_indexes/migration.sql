-- Performance indexes for lab workflow queries

-- Worklist filtering by status + assigned user (ready count, unassigned filter)
CREATE INDEX IF NOT EXISTS "ordered_tests_status_assignedUserId_idx"
  ON "ordered_tests" ("status", "assignedUserId");

-- Worklist groupBy department + status (counts endpoint)
CREATE INDEX IF NOT EXISTS "ordered_tests_status_department_idx"
  ON "ordered_tests" ("status", "department");

-- Template resolution: resolveTemplate queries by (catalogItemCode, scope, species)
CREATE INDEX IF NOT EXISTS "result_template_definitions_catalogItemCode_scope_species_idx"
  ON "result_template_definitions" ("catalogItemCode", "scope", "species");
