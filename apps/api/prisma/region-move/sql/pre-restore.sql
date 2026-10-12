-- [region-move] Fix 2 — run by restore.sh right before schema.sql.
--
-- A new Supabase project automatically grants ALL to anon, authenticated and
-- service_role on every object created in public. The dump re-adds the source's
-- grants but doesn't take those extra ones away, so without this file anon would
-- get access the source had revoked. schema.sql re-emits the source's default
-- privileges at its end.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES    FROM "anon", "authenticated", "service_role", "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role", "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role", "postgres";
