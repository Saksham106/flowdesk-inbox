-- Booking failure handling for scheduling sessions: a calendar API failure
-- must not strand the session, so the error is recorded here and surfaced in
-- the conversation Scheduling panel with a retry action.
ALTER TABLE "SchedulingSession" ADD COLUMN "lastBookingError" TEXT;
ALTER TABLE "SchedulingSession" ADD COLUMN "lastBookingAttemptAt" TIMESTAMP(3);
