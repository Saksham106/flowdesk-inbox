-- Repair silently-demoted legacy tenants.
--
-- Tenants that predate the 20260706120000 trust-ladder migration and had no
-- AutopilotSetting row derived an effective Level 3 at runtime (labels + Gmail
-- drafts, see lib/agent/automation-level.ts). But any autopilot-settings save
-- that omitted automationLevel created their row through the PATCH upsert with
-- the schema default of 2 — silently dropping them below the Level 3
-- "create Gmail drafts" gate. Their dashboard drafts kept working while the
-- Gmail-native draft writeback no-op'd.
--
-- Restore Level 3 for rows that (a) sit at Level 2, (b) belong to tenants
-- created before the ladder shipped (new signups legitimately default to 2),
-- and (c) never explicitly chose Level 2 (every explicit level change writes
-- an automation_level.changed audit row). Each repair is itself audited.
WITH repaired AS (
  UPDATE "AutopilotSetting" s
  SET "automationLevel" = 3
  WHERE s."automationLevel" = 2
    AND EXISTS (
      SELECT 1 FROM "Tenant" t
      WHERE t."id" = s."tenantId"
        AND t."createdAt" < TIMESTAMP '2026-07-06 12:00:00'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "AuditLog" a
      WHERE a."tenantId" = s."tenantId"
        AND a."action" = 'automation_level.changed'
        AND a."payloadJson"->>'to' = '2'
    )
  RETURNING s."tenantId"
)
INSERT INTO "AuditLog" ("id", "tenantId", "action", "payloadJson", "createdAt")
SELECT
  gen_random_uuid()::text,
  r."tenantId",
  'automation_level.repaired',
  jsonb_build_object('from', 2, 'to', 3, 'reason', 'legacy_upsert_default_demotion'),
  NOW()
FROM repaired r;

-- Queue Gmail-native draft creation for the repaired tenants' existing
-- proposed drafts. While demoted, queueGmailDraftWriteback no-op'd, so those
-- drafts exist only in the dashboard and nothing re-queues them until the next
-- fresh suggestion. The normal writeback cron drains these; the processor
-- itself re-checks draft status/thread validity, so a stale row degrades to a
-- "skipped" resolution. Identifies repaired tenants via the audit rows written
-- above; ON CONFLICT keeps this idempotent against any existing queue row.
INSERT INTO "EmailWritebackQueue"
  ("id", "tenantId", "channelId", "conversationId", "action",
   "providerMessageIdsJson", "attempts", "status", "nextAttemptAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."tenantId",
  c."channelId",
  c."id",
  'create_draft',
  jsonb_build_object('threadId', c."externalThreadId"),
  0,
  'pending',
  NOW(),
  NOW(),
  NOW()
FROM "Conversation" c
JOIN "Draft" d ON d."conversationId" = c."id" AND d."status" = 'proposed'
JOIN "Channel" ch ON ch."id" = c."channelId" AND ch."provider" IN ('google', 'microsoft')
WHERE c."externalThreadId" <> ''
  AND EXISTS (
    SELECT 1 FROM "AuditLog" a
    WHERE a."tenantId" = c."tenantId"
      AND a."action" = 'automation_level.repaired'
  )
ON CONFLICT ("conversationId", "action") DO NOTHING;
