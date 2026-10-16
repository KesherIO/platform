-- Lab roles consolidation (lab meeting 2026-10-15, docs/LAB_PERMISSION_MATRIX.md):
--   lab roles are OWNER, ADMIN, REVIEWER, ANALYST, RESULTS_VIEWER, MESSENGER.
--   Lab TECHNICIAN ("Personal") and DATA_ENTRY ("Digitador") members become ANALYST.
-- TECHNICIAN and DATA_ENTRY stay in the enum: clinic staff use TECHNICIAN and
-- old membership_events rows reference both. Clinic memberships are untouched.

-- New values first; none of them is used below in this migration.
ALTER TYPE "TenantRole" ADD VALUE 'RESULTS_VIEWER';
ALTER TYPE "MembershipEventType" ADD VALUE 'IN_PROGRESS_ACCESS_CHANGED';

ALTER TABLE "user_tenant_memberships"
  ADD COLUMN "canViewInProgress" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "membership_events"
  ADD COLUMN "previousCanViewInProgress" BOOLEAN,
  ADD COLUMN "newCanViewInProgress" BOOLEAN;

-- Record the move in each lab's team history (actor = system), then move.
INSERT INTO "membership_events" (
  "id", "tenantId", "eventType", "targetUserId", "targetName", "targetEmail",
  "actorUserId", "actorName", "previousRole", "newRole",
  "previousCanPerformPickups", "newCanPerformPickups", "reason", "source"
)
SELECT
  gen_random_uuid()::text,
  m."tenantId",
  'ROLE_CHANGED',
  m."userId",
  COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u."firstName", u."lastName")), ''), u."email"),
  u."email",
  NULL,
  NULL,
  m."role",
  'ANALYST',
  m."canPerformPickups",
  m."canPerformPickups",
  'Lab roles consolidation 2026-10-15: Personal and Digitador are now Analista',
  'migration'
FROM "user_tenant_memberships" m
JOIN "tenants" t ON t."id" = m."tenantId"
JOIN "users" u ON u."id" = m."userId"
WHERE t."type" IN ('LAB', 'PLATFORM')
  AND m."role" IN ('TECHNICIAN', 'DATA_ENTRY');

UPDATE "user_tenant_memberships" m
SET "role" = 'ANALYST'
FROM "tenants" t
WHERE t."id" = m."tenantId"
  AND t."type" IN ('LAB', 'PLATFORM')
  AND m."role" IN ('TECHNICIAN', 'DATA_ENTRY');
