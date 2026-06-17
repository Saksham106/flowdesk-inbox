CREATE TABLE "SnoozeReminder" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snoozeUntil" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SnoozeReminder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SnoozeReminder_tenantId_status_snoozeUntil_idx"
  ON "SnoozeReminder"("tenantId", "status", "snoozeUntil");
CREATE INDEX "SnoozeReminder_conversationId_idx"
  ON "SnoozeReminder"("conversationId");

ALTER TABLE "SnoozeReminder" ADD CONSTRAINT "SnoozeReminder_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnoozeReminder" ADD CONSTRAINT "SnoozeReminder_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
