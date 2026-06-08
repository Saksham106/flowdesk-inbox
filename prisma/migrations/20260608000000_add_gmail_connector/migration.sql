-- Add email channel type and Google provider
ALTER TYPE "ChannelType" ADD VALUE IF NOT EXISTS 'email';
ALTER TYPE "ChannelProvider" ADD VALUE IF NOT EXISTS 'google';

-- Make phoneNumberE164 nullable (email channels have no phone number)
ALTER TABLE "Channel" ALTER COLUMN "phoneNumberE164" DROP NOT NULL;

-- Add emailAddress column for Gmail channels
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "emailAddress" TEXT;

-- Unique constraint on emailAddress
CREATE UNIQUE INDEX IF NOT EXISTS "Channel_emailAddress_key" ON "Channel"("emailAddress");

-- GmailCredential table
CREATE TABLE IF NOT EXISTS "GmailCredential" (
    "id"                    TEXT NOT NULL,
    "channelId"             TEXT NOT NULL,
    "accessTokenEncrypted"  TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiry"           TIMESTAMP(3),
    "historyId"             TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GmailCredential_channelId_key" ON "GmailCredential"("channelId");

ALTER TABLE "GmailCredential"
    ADD CONSTRAINT "GmailCredential_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
