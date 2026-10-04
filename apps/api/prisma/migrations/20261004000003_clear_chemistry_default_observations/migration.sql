-- Chemistry (Bioquímica + Electrolitos) templates no longer pre-fill observations.
-- Only clears versions whose text still matches the original platform seed, so
-- observations a lab wrote itself are kept.
UPDATE "result_template_versions" AS v
SET "defaultObservations" = NULL
FROM "result_template_definitions" AS d
WHERE v."definitionId" = d."id"
  AND (d."catalogItemCode", v."defaultObservations") IN (
  ('ALB', 'Tipo de muestra: suero.'),
  ('ALP', 'Tipo de muestra: suero.'),
  ('ALT', 'Tipo de muestra: suero.'),
  ('AMY', 'Tipo de muestra: suero.'),
  ('AST', 'Tipo de muestra: suero.'),
  ('BILE_ACIDS', 'Tipo de muestra: suero. Ayuno de 12 h para muestra preprandial; muestra posprandial 2 h después de alimentar.'),
  ('BUN', 'Tipo de muestra: suero.'),
  ('CA', 'Tipo de muestra: suero.'),
  ('CA_ION', 'Tipo de muestra: suero.'),
  ('CHOL', 'Tipo de muestra: suero.'),
  ('CL', 'Tipo de muestra: suero.'),
  ('CO2', 'Tipo de muestra: suero.'),
  ('CPK', 'Tipo de muestra: suero.'),
  ('CREA', 'Tipo de muestra: suero.'),
  ('CRP', 'Tipo de muestra: suero.'),
  ('DBIL', 'Tipo de muestra: suero.'),
  ('FE', 'Tipo de muestra: suero.'),
  ('FOLATE', 'Tipo de muestra: suero.'),
  ('FOLATE_B12', 'Tipo de muestra: suero.'),
  ('GGT', 'Tipo de muestra: suero.'),
  ('GLU', 'Tipo de muestra: suero.'),
  ('K', 'Tipo de muestra: suero.'),
  ('LDH', 'Tipo de muestra: suero.'),
  ('LIP', 'Tipo de muestra: suero.'),
  ('LIPASE_SPEC', 'Tipo de muestra: suero / plasma EDTA.'),
  ('LIPASE_SPEC', 'Tipo de muestra: suero.'),
  ('MG', 'Tipo de muestra: suero.'),
  ('NA', 'Tipo de muestra: suero.'),
  ('NH3', 'Tipo de muestra: plasma con EDTA. Procesar dentro de los 30 minutos de la toma.'),
  ('PHOS', 'Tipo de muestra: suero.'),
  ('SDMA', 'Tipo de muestra: suero.'),
  ('TBIL', 'Tipo de muestra: suero.'),
  ('TP_SER', 'Tipo de muestra: suero.'),
  ('TRIG', 'Tipo de muestra: suero.'),
  ('UA', 'Tipo de muestra: suero.'),
  ('VIT_B12', 'Tipo de muestra: suero.')
  );
