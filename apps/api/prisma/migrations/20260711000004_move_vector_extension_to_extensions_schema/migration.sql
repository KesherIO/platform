-- =============================================================================
-- Migration: Move vector extension from public to extensions schema
-- Date: 2026-07-11
-- Context:
--   pgvector was installed in the public schema, which Supabase flags as a
--   security warning (lint rule: extensions in public schema).
--
--   Supabase includes the extensions schema in its default search_path
--   ("$user", public, extensions), so all existing ::vector casts and
--   vector(1536) column type references resolve without any code changes.
-- =============================================================================

ALTER EXTENSION vector SET SCHEMA extensions;
