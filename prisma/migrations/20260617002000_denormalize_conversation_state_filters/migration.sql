ALTER TABLE "ConversationState"
  ADD COLUMN IF NOT EXISTS "attentionCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "emailType" TEXT,
  ADD COLUMN IF NOT EXISTS "isSalesLead" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isSupport" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ConversationState"
SET
  "attentionCategory" = CASE
    WHEN jsonb_typeof("metadataJson"::jsonb -> 'attentionCategory') = 'string'
      THEN "metadataJson"::jsonb ->> 'attentionCategory'
    ELSE NULL
  END,
  "emailType" = CASE
    WHEN jsonb_typeof("metadataJson"::jsonb -> 'emailType') = 'string'
      THEN "metadataJson"::jsonb ->> 'emailType'
    ELSE NULL
  END,
  "isSalesLead" = CASE
    WHEN jsonb_typeof("metadataJson"::jsonb -> 'isSalesLead') = 'boolean'
      THEN ("metadataJson"::jsonb ->> 'isSalesLead')::boolean
    ELSE false
  END,
  "isSupport" = CASE
    WHEN jsonb_typeof("metadataJson"::jsonb -> 'isSupport') = 'boolean'
      THEN ("metadataJson"::jsonb ->> 'isSupport')::boolean
    ELSE false
  END
WHERE "metadataJson" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ConversationState_tenantId_attentionCategory_idx"
  ON "ConversationState"("tenantId", "attentionCategory");

CREATE INDEX IF NOT EXISTS "ConversationState_tenantId_isSalesLead_idx"
  ON "ConversationState"("tenantId", "isSalesLead");

CREATE INDEX IF NOT EXISTS "ConversationState_tenantId_isSupport_idx"
  ON "ConversationState"("tenantId", "isSupport");
