-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('LAB_PICKUP', 'CLIENT_DELIVERY');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'NOTIFIED', 'ACCEPTED', 'COLLECTED', 'IN_TRANSIT', 'RECEIVED_AT_LAB', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "TimelineEventType" AS ENUM ('ORDER_CREATED', 'PICKUP_REQUESTED', 'PICKUP_ASSIGNED', 'NOTIFICATION_SENT', 'NOTIFICATION_FAILED', 'PICKUP_ACCEPTED', 'SAMPLE_COLLECTED', 'IN_TRANSIT', 'RECEIVED_AT_LAB', 'PICKUP_CANCELLED', 'PICKUP_FAILED', 'PROBLEM_REPORTED', 'PROCESSING_STARTED', 'RESULTS_COMPLETED', 'REPORT_RELEASED');

-- AlterEnum
ALTER TYPE "TenantRole" ADD VALUE 'MESSENGER';

-- DropIndex
DROP INDEX "catalog_items_labTenantId_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryMethod" "DeliveryMethod";

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "collectionHours" TEXT,
ADD COLUMN     "defaultDeliveryMethod" "DeliveryMethod",
ADD COLUMN     "pickupAddress" TEXT,
ADD COLUMN     "pickupContactName" TEXT,
ADD COLUMN     "pickupContactPhone" TEXT,
ADD COLUMN     "pickupEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickupInstructions" TEXT;

-- CreateTable
CREATE TABLE "pickups" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "labTenantId" TEXT NOT NULL,
    "clinicTenantId" TEXT NOT NULL,
    "status" "PickupStatus" NOT NULL DEFAULT 'REQUESTED',
    "priority" "OrderPriority" NOT NULL DEFAULT 'ROUTINE',
    "pickupAddress" TEXT,
    "pickupContactName" TEXT,
    "pickupContactPhone" TEXT,
    "pickupInstructions" TEXT,
    "requestedPickupTime" TIMESTAMP(3),
    "messengerId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notifyFailReason" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pickupId" TEXT,
    "eventType" "TimelineEventType" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pickups_orderId_key" ON "pickups"("orderId");

-- CreateIndex
CREATE INDEX "pickups_labTenantId_status_idx" ON "pickups"("labTenantId", "status");

-- CreateIndex
CREATE INDEX "pickups_messengerId_status_idx" ON "pickups"("messengerId", "status");

-- CreateIndex
CREATE INDEX "timeline_events_orderId_createdAt_idx" ON "timeline_events"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_labTenantId_fkey" FOREIGN KEY ("labTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_clinicTenantId_fkey" FOREIGN KEY ("clinicTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_messengerId_fkey" FOREIGN KEY ("messengerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "pickups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

