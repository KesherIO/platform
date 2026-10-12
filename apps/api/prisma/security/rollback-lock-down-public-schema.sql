-- EMERGENCY ROLLBACK for 20261008000000_lock_down_public_schema.
-- Restores the grants and RLS state from before the lockdown (what Ireland had
-- on 2026-10-12). Only use it if the lockdown breaks something that can't be
-- fixed forward — it reopens the Data API exposure. Run with psql as postgres,
-- in one transaction. The Prisma history still lists the migration as applied:
-- fix forward with a new migration rather than re-running this one.
BEGIN;

ALTER TABLE public.analyzers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_lab_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_signers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_test_configurations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_test_specimen_requirements DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.laboratory_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordered_test_sources DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordered_test_specimens DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordered_tests DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickups DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_template_definitions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_template_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.specimens DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_lab_verifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_verification_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.veterinarian_credentials DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.veterinarian_profiles DISABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO anon, authenticated, PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;

COMMIT;
