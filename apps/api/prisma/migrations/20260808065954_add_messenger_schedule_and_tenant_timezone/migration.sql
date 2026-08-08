-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "user_tenant_memberships" ADD COLUMN     "schedule" JSONB;

