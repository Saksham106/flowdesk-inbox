-- Temporarily change the column to TEXT so we can drop and recreate the enum
ALTER TABLE "Conversation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Conversation" ALTER COLUMN "status" TYPE TEXT;

-- Drop the old enum and recreate with the correct values
DROP TYPE "ConversationStatus";
CREATE TYPE "ConversationStatus" AS ENUM ('needs_reply', 'in_progress', 'closed');

-- Cast the column back, migrating any existing 'open' rows to 'needs_reply'
ALTER TABLE "Conversation"
  ALTER COLUMN "status" TYPE "ConversationStatus"
  USING CASE status
    WHEN 'open'        THEN 'needs_reply'::"ConversationStatus"
    WHEN 'needs_reply' THEN 'needs_reply'::"ConversationStatus"
    WHEN 'in_progress' THEN 'in_progress'::"ConversationStatus"
    WHEN 'closed'      THEN 'closed'::"ConversationStatus"
    ELSE 'needs_reply'::"ConversationStatus"
  END;

ALTER TABLE "Conversation" ALTER COLUMN "status" SET DEFAULT 'needs_reply';

-- CreateTable Contact
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- Add contactId to Conversation
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "contactId" TEXT;

-- Indexes
CREATE UNIQUE INDEX "Contact_tenantId_phoneE164_key" ON "Contact"("tenantId", "phoneE164");

-- Foreign keys
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

