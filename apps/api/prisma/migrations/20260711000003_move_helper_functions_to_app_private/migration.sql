-- =============================================================================
-- Migration: Move RLS helper functions to app_private schema
-- Date: 2026-07-11
-- Supersedes: 20260711000002_revoke_anon_execute_on_helper_functions
-- Context:
--   is_tenant_member() and tenant_role() are SECURITY DEFINER functions in the
--   public schema. Because public is exposed to PostgREST, Supabase flags them
--   as callable via /rest/v1/rpc/ by both anon and authenticated roles.
--
--   Root fix: move functions to app_private, which is NOT exposed to PostgREST.
--   PostgREST will have no RPC endpoint for them regardless of EXECUTE grants.
--   Supabase lint will stop flagging them.
--
--   Both anon and authenticated still need EXECUTE so that RLS policies on
--   tenant-scoped tables can evaluate the function when those roles query them.
--   This is safe: both functions internally scope their queries to auth.uid()
--   so a caller can only check their own membership, never another user's.
--
--   All 14 RLS policies that reference public.is_tenant_member / public.tenant_role
--   are dropped and recreated with the app_private schema prefix.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Create private schema (not in PostgREST exposed_schemas — public only)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_private;

-- Both roles need USAGE on the schema for RLS policy evaluation.
GRANT USAGE ON SCHEMA app_private TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Create functions in app_private
--    Still SECURITY DEFINER — needed to read user_tenant_memberships when RLS
--    on that table would otherwise block the read.
--    search_path locked to public to prevent search-path injection attacks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.is_tenant_member(p_tenant_id TEXT)
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_tenant_memberships
    WHERE "userId"   = auth.uid()::TEXT
      AND "tenantId" = p_tenant_id
  );
$$;

CREATE OR REPLACE FUNCTION app_private.tenant_role(p_tenant_id TEXT)
  RETURNS TEXT
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT role::TEXT
  FROM public.user_tenant_memberships
  WHERE "userId"   = auth.uid()::TEXT
    AND "tenantId" = p_tenant_id
  LIMIT 1;
$$;

-- Both roles need EXECUTE for RLS policy evaluation. Since app_private is not
-- in PostgREST's exposed schemas, there is no RPC endpoint — EXECUTE here only
-- enables internal SQL evaluation, not external API access.
GRANT EXECUTE ON FUNCTION app_private.is_tenant_member(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION app_private.tenant_role(text) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Drop old RLS policies that reference public.is_tenant_member / tenant_role
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenants: members can select"                          ON public.tenants;
DROP POLICY IF EXISTS "tenants: admin/owner can update"                      ON public.tenants;
DROP POLICY IF EXISTS "memberships: tenant members can select"               ON public.user_tenant_memberships;
DROP POLICY IF EXISTS "invitations: admin/owner can select"                  ON public.tenant_invitations;
DROP POLICY IF EXISTS "cases: tenant members can select"                     ON public.cases;
DROP POLICY IF EXISTS "cases: tenant members can insert"                     ON public.cases;
DROP POLICY IF EXISTS "cases: tenant members can update"                     ON public.cases;
DROP POLICY IF EXISTS "case_catalog_items: tenant members can select via case" ON public.case_catalog_items;
DROP POLICY IF EXISTS "case_catalog_items: tenant members can insert via case" ON public.case_catalog_items;
DROP POLICY IF EXISTS "case_catalog_items: tenant members can delete via case" ON public.case_catalog_items;
DROP POLICY IF EXISTS "orders: tenant members can select"                    ON public.orders;
DROP POLICY IF EXISTS "orders: tenant members can insert"                    ON public.orders;
DROP POLICY IF EXISTS "orders: tenant members can update"                    ON public.orders;
DROP POLICY IF EXISTS "result_reports: clinic members see released"          ON public.result_reports;

-- ---------------------------------------------------------------------------
-- 4. Recreate all policies pointing to app_private
-- ---------------------------------------------------------------------------

-- tenants
CREATE POLICY "tenants: members can select"
  ON public.tenants FOR SELECT
  USING (app_private.is_tenant_member(id));

CREATE POLICY "tenants: admin/owner can update"
  ON public.tenants FOR UPDATE
  USING (app_private.tenant_role(id) IN ('ADMIN', 'OWNER'))
  WITH CHECK (app_private.tenant_role(id) IN ('ADMIN', 'OWNER'));

-- user_tenant_memberships
CREATE POLICY "memberships: tenant members can select"
  ON public.user_tenant_memberships FOR SELECT
  USING (app_private.is_tenant_member("tenantId"));

-- tenant_invitations
CREATE POLICY "invitations: admin/owner can select"
  ON public.tenant_invitations FOR SELECT
  USING (app_private.is_tenant_member("tenantId"));

-- cases
CREATE POLICY "cases: tenant members can select"
  ON public.cases FOR SELECT
  USING (app_private.is_tenant_member("tenantId"));

CREATE POLICY "cases: tenant members can insert"
  ON public.cases FOR INSERT
  WITH CHECK (
    app_private.is_tenant_member("tenantId")
    AND "createdByUserId" = auth.uid()::TEXT
  );

CREATE POLICY "cases: tenant members can update"
  ON public.cases FOR UPDATE
  USING (app_private.is_tenant_member("tenantId"))
  WITH CHECK (app_private.is_tenant_member("tenantId"));

-- case_catalog_items
CREATE POLICY "case_catalog_items: tenant members can select via case"
  ON public.case_catalog_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = "caseId"
        AND app_private.is_tenant_member(c."tenantId")
    )
  );

CREATE POLICY "case_catalog_items: tenant members can insert via case"
  ON public.case_catalog_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = "caseId"
        AND app_private.is_tenant_member(c."tenantId")
    )
  );

CREATE POLICY "case_catalog_items: tenant members can delete via case"
  ON public.case_catalog_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = "caseId"
        AND app_private.is_tenant_member(c."tenantId")
    )
  );

-- orders
CREATE POLICY "orders: tenant members can select"
  ON public.orders FOR SELECT
  USING (app_private.is_tenant_member("tenantId"));

CREATE POLICY "orders: tenant members can insert"
  ON public.orders FOR INSERT
  WITH CHECK (app_private.is_tenant_member("tenantId"));

CREATE POLICY "orders: tenant members can update"
  ON public.orders FOR UPDATE
  USING (app_private.is_tenant_member("tenantId"))
  WITH CHECK (app_private.is_tenant_member("tenantId"));

-- result_reports
CREATE POLICY "result_reports: clinic members see released"
  ON public.result_reports FOR SELECT
  USING (
    status = 'RELEASED'
    AND app_private.is_tenant_member("tenantId")
  );

-- ---------------------------------------------------------------------------
-- 5. Drop the old public functions
--    Revoke first in case migration 20260711000002 was already applied and
--    REVOKE on a non-existent function would error.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_tenant_member(text);
DROP FUNCTION IF EXISTS public.tenant_role(text);
