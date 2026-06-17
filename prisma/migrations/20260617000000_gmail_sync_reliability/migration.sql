ALTER TABLE "GmailCredential"
  ADD COLUMN IF NOT EXISTS "watchLastRenewalAttempt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "watchRenewalError" TEXT,
  ADD COLUMN IF NOT EXISTS "lastHistoryFallbackAt" TIMESTAMP(3);

CREATE TABLE "GmailPushEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "historyId" TEXT,
  "messageId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "GmailPushEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GmailWritebackQueue" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "providerMessageIdsJson" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GmailWritebackQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GmailPushEvent_messageId_key" ON "GmailPushEvent"("messageId");
CREATE INDEX "GmailPushEvent_tenantId_channelId_idx" ON "GmailPushEvent"("tenantId", "channelId");
CREATE INDEX "GmailPushEvent_status_idx" ON "GmailPushEvent"("status");

CREATE UNIQUE INDEX "GmailWritebackQueue_conversationId_action_key" ON "GmailWritebackQueue"("conversationId", "action");
CREATE INDEX "GmailWritebackQueue_tenantId_status_nextAttemptAt_idx" ON "GmailWritebackQueue"("tenantId", "status", "nextAttemptAt");

ALTER TABLE "GmailPushEvent" ADD CONSTRAINT "GmailPushEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GmailPushEvent" ADD CONSTRAINT "GmailPushEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GmailWritebackQueue" ADD CONSTRAINT "GmailWritebackQueue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GmailWritebackQueue" ADD CONSTRAINT "GmailWritebackQueue_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GmailWritebackQueue" ADD CONSTRAINT "GmailWritebackQueue_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
