-- =============================================================================
-- Migration: Enable RLS on knowledge_documents and knowledge_chunks
-- Date: 2026-07-11
-- Context:
--   These tables were added after the bulk RLS migration (20260426000000) and
--   were left exposed over PostgREST without row-level security.
--
--   Access model: backend-only.
--   The NestJS RAG service reads both tables via $queryRawUnsafe using the
--   postgres superuser connection, which bypasses RLS. No frontend or
--   PostgREST consumer ever needs direct access.
--
--   Strategy: RLS ON + FORCE RLS, zero policies.
--   Zero policies = deny-all for PostgREST (anon and authenticated roles).
--   The postgres superuser (Prisma / ingest scripts) is unaffected.
-- =============================================================================

-- knowledge_documents: Biomet-managed document registry. Backend-only.
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents FORCE ROW LEVEL SECURITY;
-- No policies → PostgREST callers see 0 rows and cannot insert/update/delete.

-- knowledge_chunks: vector embeddings derived from knowledge_documents. Backend-only.
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks FORCE ROW LEVEL SECURITY;
-- No policies → PostgREST callers see 0 rows and cannot insert/update/delete.
