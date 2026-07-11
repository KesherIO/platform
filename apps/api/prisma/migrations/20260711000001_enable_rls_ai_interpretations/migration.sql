-- =============================================================================
-- Migration: Enable RLS on ai_interpretations
-- Date: 2026-07-11
-- Context:
--   Table was added after the bulk RLS migration (20260426000000) and was
--   left exposed over PostgREST without row-level security.
--
--   Access model: backend-only.
--   The NestJS results service reads and writes this table exclusively via
--   the postgres superuser connection (Prisma), which bypasses RLS.
--   The frontend fetches AI interpretations through the NestJS REST API —
--   never via PostgREST directly.
--
--   Strategy: RLS ON + FORCE RLS, zero policies.
--   Zero policies = deny-all for PostgREST (anon and authenticated roles).
--   The postgres superuser (Prisma) is unaffected.
-- =============================================================================

-- ai_interpretations: tenant-scoped AI output. Backend-only — never via PostgREST.
ALTER TABLE public.ai_interpretations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_interpretations FORCE ROW LEVEL SECURITY;
-- No policies → PostgREST callers see 0 rows and cannot insert/update/delete.
