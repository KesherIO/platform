-- Supabase-like roles and stubs for a LOCAL test database (local-test-db.sh).
-- Run as the local superuser (supabase_admin). Mirrors what a Supabase project
-- provides, so a schema dump of a real project loads and behaves the same:
--   postgres      — owns app objects, not a superuser, BYPASSRLS (the API's role)
--   anon, authenticated, service_role — Data API roles
--   auth.uid() / auth.role() / auth.jwt() — read the claims Supabase would set
CREATE ROLE postgres LOGIN BYPASSRLS CREATEROLE CREATEDB;
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;

-- As on Supabase, postgres owns the database (and so the public schema).
ALTER DATABASE postgres OWNER TO postgres;

CREATE SCHEMA extensions AUTHORIZATION postgres;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION vector WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO postgres, anon, authenticated, service_role;

CREATE PUBLICATION supabase_realtime;
ALTER PUBLICATION supabase_realtime OWNER TO postgres;
