-- AlterTable: add calendar scheduling fields to BusinessProfile
ALTER TABLE "BusinessProfile"
  ADD COLUMN "primaryCalendarEmail"   TEXT,
  ADD COLUMN "serviceDurationMinutes" INTEGER NOT NULL DEFAULT 60;

-- AlterTable: add computed availability slots to AgentJob
ALTER TABLE "AgentJob"
  ADD COLUMN "slotsJson" JSONB;
