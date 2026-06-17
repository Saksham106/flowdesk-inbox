-- CreateTable
CREATE TABLE "SchedulingSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'detecting',
    "proposedTimesJson" JSONB,
    "confirmedTime" TEXT,
    "calendarEmail" TEXT,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingSession_conversationId_key" ON "SchedulingSession"("conversationId");
CREATE INDEX "SchedulingSession_tenantId_status_idx" ON "SchedulingSession"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "SchedulingSession" ADD CONSTRAINT "SchedulingSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchedulingSession" ADD CONSTRAINT "SchedulingSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
