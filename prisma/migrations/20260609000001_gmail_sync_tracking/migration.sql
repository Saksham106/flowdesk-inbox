-- AlterTable
ALTER TABLE "GmailCredential"
ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN "lastSyncError" TEXT;
