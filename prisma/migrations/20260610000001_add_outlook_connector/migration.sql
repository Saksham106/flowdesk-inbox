-- ALTER TYPE ADD VALUE cannot run inside a transaction in Postgres
-- Run this file with --no-transaction or outside a transaction block
ALTER TYPE "ChannelProvider" ADD VALUE IF NOT EXISTS 'microsoft';

CREATE TABLE "OutlookCredential" (
    "id"                    TEXT NOT NULL,
    "channelId"             TEXT NOT NULL,
    "accessTokenEncrypted"  TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiry"           TIMESTAMP(3),
    "lastSyncedAt"          TIMESTAMP(3),
    "lastSyncError"         TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutlookCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutlookCredential_channelId_key" ON "OutlookCredential"("channelId");

ALTER TABLE "OutlookCredential"
    ADD CONSTRAINT "OutlookCredential_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
