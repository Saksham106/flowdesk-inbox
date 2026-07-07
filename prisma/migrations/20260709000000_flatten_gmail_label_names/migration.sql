-- Flatten FlowDesk Gmail label names: drop the legacy "FlowDesk/" namespace
-- prefix from persisted canonical identifiers so per-label enable/disable
-- settings keep matching the new flat label vocabulary. The Gmail-side labels
-- themselves are renamed in place by reconcileLegacyFlowDeskLabels (lib/google.ts).
--
-- 'FlowDesk/' is 9 characters, so the flat name starts at position 10. Canonical
-- values were always prefixed before this migration, so no unprefixed collision
-- can pre-exist for the same tenant.
UPDATE "GmailLabelMapping"
SET "canonical" = substring("canonical" from 10)
WHERE "canonical" LIKE 'FlowDesk/%';
