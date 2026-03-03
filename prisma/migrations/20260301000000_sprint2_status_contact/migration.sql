-- Step 1: Add new enum values (already applied via pre-migration script)
-- ALTER TYPE "ConversationStatus" ADD VALUE 'needs_reply';
-- ALTER TYPE "ConversationStatus" ADD VALUE 'in_progress';

-- Step 2: Migrate existing 'open' rows to 'needs_reply'
UPDATE "Conversation" SET status = 'needs_reply' WHERE status = 'open';

-- Step 3: Create new enum type without 'open'
CREATE TYPE "ConversationStatus_new" AS ENUM ('needs_reply', 'in_progress', 'closed');

-- Step 4: Swap column to new type
ALTER TABLE "Conversation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Conversation" ALTER COLUMN "status" TYPE "ConversationStatus_new" USING ("status"::text::"ConversationStatus_new");
ALTER TABLE "Conversation" ALTER COLUMN "status" SET DEFAULT 'needs_reply'::"ConversationStatus_new";

-- Step 5: Swap enum type names
ALTER TYPE "ConversationStatus" RENAME TO "ConversationStatus_old";
ALTER TYPE "ConversationStatus_new" RENAME TO "ConversationStatus";
DROP TYPE "ConversationStatus_old";

-- CreateTable: Contact
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add contactId to Conversation
ALTER TABLE "Conversation" ADD COLUMN "contactId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Contact_tenantId_phoneE164_key" ON "Contact"("tenantId", "phoneE164");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
