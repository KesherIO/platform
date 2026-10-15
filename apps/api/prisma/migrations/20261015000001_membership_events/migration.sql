-- Membership audit log (docs/SECURITY_LAB_AUTHZ.md follow-up: role-change audit).
-- New table only — no change to existing rows, no backfill: history starts at
-- deployment.

CREATE TYPE "MembershipEventType" AS ENUM (
  'MEMBER_ADDED',
  'INVITED',
  'INVITATION_ACCEPTED',
  'ROLE_CHANGED',
  'PICKUP_CAPABILITY_CHANGED',
  'DEACTIVATED',
  'REACTIVATED',
  'REMOVED'
);

CREATE TABLE "membership_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventType" "MembershipEventType" NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "targetName" TEXT,
  "targetEmail" TEXT,
  "actorUserId" TEXT,
  "actorName" TEXT,
  "previousRole" "TenantRole",
  "newRole" "TenantRole",
  "previousStatus" "MembershipStatus",
  "newStatus" "MembershipStatus",
  "previousCanPerformPickups" BOOLEAN,
  "newCanPerformPickups" BOOLEAN,
  "reason" TEXT,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "membership_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "membership_events_tenantId_createdAt_idx"
  ON "membership_events"("tenantId", "createdAt");
CREATE INDEX "membership_events_tenantId_targetUserId_createdAt_idx"
  ON "membership_events"("tenantId", "targetUserId", "createdAt");

-- Cascade only when the whole tenant is deleted; there is no FK to users so a
-- removed member's history stays.
ALTER TABLE "membership_events"
  ADD CONSTRAINT "membership_events_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only: events can't be edited. (DELETE stays possible so the tenant
-- cascade works; the app has no code path that deletes events.)
CREATE FUNCTION app_private.membership_events_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'membership_events rows are immutable';
END;
$$;

REVOKE ALL ON FUNCTION app_private.membership_events_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER membership_events_no_update
  BEFORE UPDATE ON "membership_events"
  FOR EACH ROW EXECUTE FUNCTION app_private.membership_events_immutable();

-- Same Data API lockdown as 20261008000000_lock_down_public_schema.
ALTER TABLE public.membership_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_events FROM anon, authenticated;
