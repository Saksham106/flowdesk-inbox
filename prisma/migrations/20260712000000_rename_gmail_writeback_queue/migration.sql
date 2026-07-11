-- Rename GmailWritebackQueue to EmailWritebackQueue (provider-neutral queue).
-- RENAME, not drop+create, so in-flight rows survive.
ALTER TABLE "GmailWritebackQueue" RENAME TO "EmailWritebackQueue";
ALTER INDEX "GmailWritebackQueue_pkey" RENAME TO "EmailWritebackQueue_pkey";
ALTER INDEX "GmailWritebackQueue_conversationId_action_key" RENAME TO "EmailWritebackQueue_conversationId_action_key";
ALTER INDEX "GmailWritebackQueue_tenantId_status_nextAttemptAt_idx" RENAME TO "EmailWritebackQueue_tenantId_status_nextAttemptAt_idx";
ALTER TABLE "EmailWritebackQueue" RENAME CONSTRAINT "GmailWritebackQueue_tenantId_fkey" TO "EmailWritebackQueue_tenantId_fkey";
ALTER TABLE "EmailWritebackQueue" RENAME CONSTRAINT "GmailWritebackQueue_channelId_fkey" TO "EmailWritebackQueue_channelId_fkey";
ALTER TABLE "EmailWritebackQueue" RENAME CONSTRAINT "GmailWritebackQueue_conversationId_fkey" TO "EmailWritebackQueue_conversationId_fkey";
