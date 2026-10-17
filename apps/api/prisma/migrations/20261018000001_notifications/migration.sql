-- Shared notification foundation: one inbox row per recipient (notifications)
-- and a per-channel delivery outbox (notification_deliveries) worked by the
-- API's NotificationDeliveryWorker. Existing push subscriptions all come from
-- the lab app's messengers, hence app = 'LAB' by default. No backfill.

-- CreateEnum
CREATE TYPE "PushApp" AS ENUM ('LAB', 'CLINIC');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TESTS_ADDED', 'ADDITIONAL_SAMPLE_REQUIRED', 'RESULTS_RELEASED', 'RESULTS_AMENDED', 'PICKUP_ASSIGNED', 'PICKUP_UNASSIGNED', 'PICKUP_CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WEB_PUSH');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'SKIPPED', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "push_subscriptions" ADD COLUMN     "app" "PushApp" NOT NULL DEFAULT 'LAB';

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "orderId" TEXT,
    "pickupId" TEXT,
    "params" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipientUserId_tenantId_createdAt_idx" ON "notifications"("recipientUserId", "tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_recipientUserId_readAt_idx" ON "notifications"("recipientUserId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipientUserId_dedupeKey_key" ON "notifications"("recipientUserId", "dedupeKey");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "pickups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data API lockdown (docs/SECURITY_LOCKDOWN.md): RLS on, no policies — only
-- the API's own connection reads these tables.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
