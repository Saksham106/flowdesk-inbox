-- CreateEnum
CREATE TYPE "CalendarHoldStatus" AS ENUM ('held', 'confirmed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "CalendarHold" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "conversationId"  TEXT NOT NULL,
    "calendarEmail"   TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "status"          "CalendarHoldStatus" NOT NULL DEFAULT 'held',
    "startAt"         TIMESTAMP(3) NOT NULL,
    "endAt"           TIMESTAMP(3) NOT NULL,
    "expiresAt"       TIMESTAMP(3) NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarHold_tenantId_status_idx"  ON "CalendarHold"("tenantId", "status");
CREATE INDEX "CalendarHold_conversationId_idx"   ON "CalendarHold"("conversationId");
CREATE INDEX "CalendarHold_expiresAt_status_idx" ON "CalendarHold"("expiresAt", "status");

-- AddForeignKey
ALTER TABLE "CalendarHold" ADD CONSTRAINT "CalendarHold_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CalendarHold" ADD CONSTRAINT "CalendarHold_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
