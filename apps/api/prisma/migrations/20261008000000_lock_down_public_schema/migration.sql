-- =============================================================================
-- Migration: Lock down the public schema (Data API roles)
-- Date: 2026-10-12 (named 20261008… so it sorts before the pending
--       20261010000001 migration: it is applied to production first, alone —
--       see docs/SECURITY_LOCKDOWN.md)
-- Context:
--   Supabase gives anon and authenticated ALL privileges on every object created
--   in public. 19 tables had RLS off, so anyone with the public anon key could
--   read, insert, update and delete them through the Data API (PostgREST).
--
--   No app uses the Data API: both frontends only call supabase.auth.*, and the
--   NestJS API connects as postgres (BYPASSRLS), which is not affected by RLS or
--   by the grants below. service_role keeps its grants (server-side key only).
--
--   Defence in depth, together with turning the Data API off in the dashboard:
--     1. RLS on for the 19 remaining tables (no policies = deny-all).
--     2. anon/authenticated lose every privilege on public tables, sequences
--        and functions, and on the app_private helper functions.
--     3. Default privileges: objects created later by postgres (migrations) no
--        longer get those grants.
--   The existing RLS policies are left in place; with no privileges they are
--   never reached.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Row-level security on the tables that still had it off
-- ---------------------------------------------------------------------------
ALTER TABLE public.analyzers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_lab_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_test_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_test_specimen_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laboratory_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordered_test_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordered_test_specimens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordered_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_template_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specimens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_lab_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veterinarian_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veterinarian_profiles ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. No direct access for the Data API roles
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC;

-- The helpers were only granted so RLS policies could run for these roles.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM anon, authenticated, PUBLIC;
REVOKE USAGE ON SCHEMA app_private FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Future objects created by postgres (i.e. by migrations)
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
-- Postgres still makes every NEW function executable by PUBLIC (a built-in
-- default that per-schema default privileges can't remove). A migration that
-- adds a function must REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated;
-- the security test (public-schema-lockdown.int.spec.ts) fails until it does.
