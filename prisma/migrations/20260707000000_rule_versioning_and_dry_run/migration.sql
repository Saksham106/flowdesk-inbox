-- Rule versioning + dry-run tracking (Gmail-native plan Phase 2 P0).
-- Versions increment on behavior-changing edits; prior versions are
-- snapshotted to AuditLog ("agent_rule.version_snapshot") rather than a new
-- table. Executions record the rule version that fired in their metadata.

ALTER TABLE "AgentRule" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AgentRule" ADD COLUMN "lastDryRunAt" TIMESTAMP(3);

ALTER TABLE "SenderRule" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
