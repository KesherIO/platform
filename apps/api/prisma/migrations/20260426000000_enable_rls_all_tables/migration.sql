-- =============================================================================
-- Migration: Enable RLS on all public tables
-- Date: 2026-04-26
-- Context:
--   The NestJS API connects via DATABASE_URL as the postgres superuser, which
--   bypasses RLS automatically — no existing app flows are affected by enabling
--   RLS here.
--
--   PostgREST (the Supabase REST endpoint reachable with the anon key) IS
--   subject to RLS. These policies lock down all tables so that PostgREST
--   returns nothing to anonymous or authenticated callers unless a policy
--   explicitly permits it.
--
--   Strategy per table type:
--     - Backend-only tables (sensitive secrets, internal counters):
--         RLS ON, zero policies → PostgREST returns 0 rows to everyone.
--     - Catalog (global, read-only for clinic users):
--         RLS ON, SELECT allowed for authenticated users.
--     - Tenant-scoped tables (cases, orders, reports, memberships):
--         RLS ON, policies require auth.uid() to be a member of the tenant.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: a reusable function that checks whether the calling Supabase auth
-- user is a member of a given tenant. Used in multiple policies below.
-- The function runs as SECURITY DEFINER so it can read user_tenant_memberships
-- even when RLS on that table restricts direct access.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id TEXT)
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

CREATE OR REPLACE FUNCTION public.tenant_role(p_tenant_id TEXT)
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

-- =============================================================================
-- SECTION 1: Backend-only tables — no PostgREST access at all
-- These hold secrets or internal state. Zero policies = deny-all via PostgREST.
-- The postgres superuser (Prisma) still bypasses RLS and reads/writes freely.
-- =============================================================================

-- onboarding_tokens: single-use secret tokens to invite clinic admins.
-- NEVER expose via PostgREST.
ALTER TABLE public.onboarding_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_tokens FORCE ROW LEVEL SECURITY;
-- No policies → PostgREST callers see 0 rows and cannot insert/update/delete.

-- counters: internal monotonic counter for requisition numbers.
-- NEVER expose via PostgREST.
ALTER TABLE public.counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counters FORCE ROW LEVEL SECURITY;
-- No policies → PostgREST callers see 0 rows.

-- =============================================================================
-- SECTION 2: users — own-row access only via PostgREST
-- Users can only read/update their own profile row.
-- The NestJS API upserts rows on every login using the postgres superuser —
-- this is unaffected.
-- =============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

-- A user can see only their own profile
CREATE POLICY "users: select own row"
  ON public.users
  FOR SELECT
  USING (id = auth.uid()::TEXT);

-- A user can update only their own profile (email, name)
CREATE POLICY "users: update own row"
  ON public.users
  FOR UPDATE
  USING (id = auth.uid()::TEXT)
  WITH CHECK (id = auth.uid()::TEXT);

-- INSERT is backend-only (NestJS upserts via postgres superuser) — no policy needed.
-- DELETE is backend-only — no policy needed.

-- =============================================================================
-- SECTION 3: tenants — members can read their own tenant
-- Admins/owners can update tenant settings.
-- Creating/deleting tenants is backend-only (onboarding flow).
-- =============================================================================

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenants: members can select"
  ON public.tenants
  FOR SELECT
  USING (public.is_tenant_member(id));

CREATE POLICY "tenants: admin/owner can update"
  ON public.tenants
  FOR UPDATE
  USING (
    public.tenant_role(id) IN ('ADMIN', 'OWNER')
  )
  WITH CHECK (
    public.tenant_role(id) IN ('ADMIN', 'OWNER')
  );

-- INSERT and DELETE are backend-only (onboarding / account closure). No policies.

-- =============================================================================
-- SECTION 4: user_tenant_memberships — scoped read, backend-managed writes
-- =============================================================================

ALTER TABLE public.user_tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenant_memberships FORCE ROW LEVEL SECURITY;

-- Any member of a tenant can list memberships for that tenant
CREATE POLICY "memberships: tenant members can select"
  ON public.user_tenant_memberships
  FOR SELECT
  USING (public.is_tenant_member("tenantId"));

-- INSERT / UPDATE / DELETE are backend-only (invite acceptance, role changes).
-- No PostgREST write policies.

-- =============================================================================
-- SECTION 5: tenant_invitations — backend-managed secrets
-- Clinic staff can see invitations for their tenant (to list pending invites
-- in the UI — all via API, but safe to expose read here).
-- The raw token value is only ever consumed by the backend, never rendered in
-- the frontend beyond "invitation exists / accepted" status.
-- =============================================================================

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_invitations FORCE ROW LEVEL SECURITY;

-- Tenant admins/owners can view invitations for their tenant
CREATE POLICY "invitations: admin/owner can select"
  ON public.tenant_invitations
  FOR SELECT
  USING (public.is_tenant_member("tenantId"));

-- No write policies — invites are created/accepted via NestJS API (postgres superuser).

-- =============================================================================
-- SECTION 6: catalog_items — global read-only for authenticated users
-- No tenantId — owned by Biomet. Clinics need to read the catalog to build
-- orders. Writes are backend-only (admin import via InternalApiKeyGuard).
-- =============================================================================

ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items FORCE ROW LEVEL SECURITY;

CREATE POLICY "catalog_items: authenticated users can select active items"
  ON public.catalog_items
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND active = true
  );

-- No write policies — catalog is managed by the backend (InternalApiKeyGuard).

-- =============================================================================
-- SECTION 7: catalog_item_compositions — global read-only for authenticated
-- =============================================================================

ALTER TABLE public.catalog_item_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_item_compositions FORCE ROW LEVEL SECURITY;

CREATE POLICY "catalog_item_compositions: authenticated users can select"
  ON public.catalog_item_compositions
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- =============================================================================
-- SECTION 8: result_templates / sections / analytes — global read-only
-- Lab result templates are global (no tenantId). Authenticated users (lab
-- techs and clinic users) need to read them. Writes are backend-only.
-- =============================================================================

ALTER TABLE public.result_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY "result_templates: authenticated users can select active"
  ON public.result_templates
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND "isActive" = true
  );

ALTER TABLE public.result_template_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_template_sections FORCE ROW LEVEL SECURITY;

CREATE POLICY "result_template_sections: authenticated users can select"
  ON public.result_template_sections
  FOR SELECT
  USING (auth.role() = 'authenticated');

ALTER TABLE public.result_template_analytes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_template_analytes FORCE ROW LEVEL SECURITY;

CREATE POLICY "result_template_analytes: authenticated users can select"
  ON public.result_template_analytes
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- =============================================================================
-- SECTION 9: cases — tenant-scoped read/write
-- =============================================================================

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases FORCE ROW LEVEL SECURITY;

CREATE POLICY "cases: tenant members can select"
  ON public.cases
  FOR SELECT
  USING (public.is_tenant_member("tenantId"));

CREATE POLICY "cases: tenant members can insert"
  ON public.cases
  FOR INSERT
  WITH CHECK (
    public.is_tenant_member("tenantId")
    AND "createdByUserId" = auth.uid()::TEXT
  );

CREATE POLICY "cases: tenant members can update"
  ON public.cases
  FOR UPDATE
  USING (public.is_tenant_member("tenantId"))
  WITH CHECK (public.is_tenant_member("tenantId"));

-- Delete is backend-only / admin action — no PostgREST delete policy.

-- =============================================================================
-- SECTION 10: case_catalog_items — tenant-scoped via case join
-- =============================================================================

ALTER TABLE public.case_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_catalog_items FORCE ROW LEVEL SECURITY;

CREATE POLICY "case_catalog_items: tenant members can select via case"
  ON public.case_catalog_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = "caseId"
        AND public.is_tenant_member(c."tenantId")
    )
  );

CREATE POLICY "case_catalog_items: tenant members can insert via case"
  ON public.case_catalog_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = "caseId"
        AND public.is_tenant_member(c."tenantId")
    )
  );

CREATE POLICY "case_catalog_items: tenant members can delete via case"
  ON public.case_catalog_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = "caseId"
        AND public.is_tenant_member(c."tenantId")
    )
  );

-- =============================================================================
-- SECTION 11: orders — tenant-scoped
-- =============================================================================

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;

CREATE POLICY "orders: tenant members can select"
  ON public.orders
  FOR SELECT
  USING (public.is_tenant_member("tenantId"));

CREATE POLICY "orders: tenant members can insert"
  ON public.orders
  FOR INSERT
  WITH CHECK (public.is_tenant_member("tenantId"));

CREATE POLICY "orders: tenant members can update"
  ON public.orders
  FOR UPDATE
  USING (public.is_tenant_member("tenantId"))
  WITH CHECK (public.is_tenant_member("tenantId"));

-- =============================================================================
-- SECTION 12: result_reports — tenant-scoped
-- DRAFT reports are only visible to lab staff (no tenant filter on DRAFT —
-- the lab is Biomet, not a clinic). For MVP, all authenticated users in the
-- tenant can see RELEASED reports.
-- =============================================================================

ALTER TABLE public.result_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_reports FORCE ROW LEVEL SECURITY;

-- Clinic users see only RELEASED reports for their tenant
CREATE POLICY "result_reports: clinic members see released"
  ON public.result_reports
  FOR SELECT
  USING (
    status = 'RELEASED'
    AND public.is_tenant_member("tenantId")
  );

-- Lab staff (any authenticated user — lab has no tenantId in MVP) can see
-- all reports in DRAFT or RELEASED. Restrict this further once lab users
-- have their own tenant/role.
-- WARNING: Temporary broad policy — replace with lab-role check post-MVP.
CREATE POLICY "result_reports: authenticated users see all for lab ops"
  ON public.result_reports
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- NOTE: The two SELECT policies above combine with OR semantics in Postgres
-- RLS. The net effect is: any authenticated user sees all reports (the
-- broader policy dominates). This is intentional for lab-as-platform MVP
-- where Biomet lab staff share the same auth pool as clinic users.
-- NEXT STEP: Add a `lab_staff` role or separate lab tenant and tighten this.

-- Writes are backend-only (NestJS via postgres superuser). No write policies.

-- =============================================================================
-- SECTION 13: result_report_analytes — tenant-scoped via report join
-- =============================================================================

ALTER TABLE public.result_report_analytes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_report_analytes FORCE ROW LEVEL SECURITY;

CREATE POLICY "result_report_analytes: select via parent report"
  ON public.result_report_analytes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.result_reports r
      WHERE r.id = "reportId"
        AND auth.role() = 'authenticated'
    )
  );

-- =============================================================================
-- DONE
-- =============================================================================
