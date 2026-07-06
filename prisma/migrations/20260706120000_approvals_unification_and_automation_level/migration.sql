-- Approvals unification (audit P2-3 / §9d) + automation trust ladder (Phase D foundation).

-- ALTER TYPE ADD VALUE cannot run inside a transaction in Postgres
ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'cancelled';

-- ApprovalRequest becomes the single approval primitive: `step` identifies what
-- is being approved (currently always "send"), metadataJson carries the source.
ALTER TABLE "ApprovalRequest" ADD COLUMN "step" TEXT NOT NULL DEFAULT 'send';
ALTER TABLE "ApprovalRequest" ADD COLUMN "metadataJson" JSONB;

-- Existing pending approvals (meeting follow-ups) are all send approvals; the
-- 'send' default backfills them, no further data migration needed.

CREATE INDEX "ApprovalRequest_tenantId_status_createdAt_idx"
    ON "ApprovalRequest"("tenantId", "status", "createdAt");

-- Automation trust ladder: explicit per-tenant Level 0-5
-- (see lib/agent/automation-level.ts for the level -> action mapping).
ALTER TABLE "AutopilotSetting" ADD COLUMN "automationLevel" INTEGER NOT NULL DEFAULT 2;

-- Existing tenants keep exactly today's effective autonomy, never more:
--   * autopilot enabled  -> Level 5 (auto-send was already configured; every
--     existing confidence/policy/budget/failure gate still applies on top)
--   * otherwise          -> Level 3 (labels + Gmail drafts are what ships today
--     for every tenant regardless of autopilot settings)
-- New tenants get the column default of 2.
UPDATE "AutopilotSetting"
SET "automationLevel" = CASE WHEN "enabled" = true THEN 5 ELSE 3 END;
