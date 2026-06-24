-- AlterTable
ALTER TABLE "OutlookCredential"
ADD COLUMN "deltaLinkEncrypted" TEXT,
ADD COLUMN "subscriptionId" TEXT,
ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN "subscriptionClientStateEncrypted" TEXT,
ADD COLUMN "subscriptionLastRenewalAttempt" TIMESTAMP(3),
ADD COLUMN "subscriptionError" TEXT,
ADD COLUMN "lastSyncMode" TEXT,
ADD COLUMN "lastSyncStatus" TEXT,
ADD COLUMN "syncLeaseId" TEXT,
ADD COLUMN "syncLockExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OutlookSyncEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "OutlookSyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutlookCredential_subscriptionId_key" ON "OutlookCredential"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "OutlookSyncEvent_notificationId_key" ON "OutlookSyncEvent"("notificationId");

-- CreateIndex
CREATE INDEX "OutlookSyncEvent_status_nextAttemptAt_idx" ON "OutlookSyncEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutlookSyncEvent_tenantId_channelId_idx" ON "OutlookSyncEvent"("tenantId", "channelId");

-- AddForeignKey
ALTER TABLE "OutlookSyncEvent" ADD CONSTRAINT "OutlookSyncEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutlookSyncEvent" ADD CONSTRAINT "OutlookSyncEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
