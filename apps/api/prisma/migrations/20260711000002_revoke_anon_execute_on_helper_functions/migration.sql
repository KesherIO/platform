-- =============================================================================
-- Migration: Revoke anon EXECUTE on RLS helper functions
-- Date: 2026-07-11
-- Context:
--   PostgreSQL grants EXECUTE to PUBLIC by default on newly created functions,
--   which means the Supabase `anon` role can invoke is_tenant_member() and
--   tenant_role() directly via PostgREST RPC (/rest/v1/rpc/...).
--   Neither function should be callable by unauthenticated users.
--
--   Note on `authenticated` role:
--   EXECUTE is intentionally kept for the `authenticated` role. These functions
--   are called from RLS policies on tenants, cases, orders, memberships, etc.
--   Revoking from `authenticated` would cause "permission denied for function"
--   errors on every query to those tables. The functions are safe to expose to
--   authenticated users because both are scoped to auth.uid() internally —
--   a caller can only discover their own membership, never another user's.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.is_tenant_member(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.tenant_role(text) FROM anon;
