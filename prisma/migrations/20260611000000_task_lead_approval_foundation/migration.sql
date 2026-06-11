-- Persist command-center state, task extraction, and lead extraction.

CREATE TABLE "ConversationState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "nextAction" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'deterministic',
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboxTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'deterministic',
    "sourceMessageId" TEXT,
    "deterministicKey" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "need" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'medium',
    "budgetClue" TEXT,
    "contactInfo" TEXT,
    "nextAction" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "source" TEXT NOT NULL DEFAULT 'deterministic',
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationState_conversationId_key" ON "ConversationState"("conversationId");
CREATE INDEX "ConversationState_tenantId_state_idx" ON "ConversationState"("tenantId", "state");
CREATE INDEX "ConversationState_tenantId_priority_idx" ON "ConversationState"("tenantId", "priority");

CREATE UNIQUE INDEX "InboxTask_tenantId_deterministicKey_key" ON "InboxTask"("tenantId", "deterministicKey");
CREATE INDEX "InboxTask_tenantId_status_idx" ON "InboxTask"("tenantId", "status");
CREATE INDEX "InboxTask_tenantId_dueAt_idx" ON "InboxTask"("tenantId", "dueAt");
CREATE INDEX "InboxTask_conversationId_idx" ON "InboxTask"("conversationId");

CREATE UNIQUE INDEX "Lead_tenantId_conversationId_key" ON "Lead"("tenantId", "conversationId");
CREATE INDEX "Lead_tenantId_stage_idx" ON "Lead"("tenantId", "stage");
CREATE INDEX "Lead_tenantId_score_idx" ON "Lead"("tenantId", "score");

ALTER TABLE "ConversationState" ADD CONSTRAINT "ConversationState_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationState" ADD CONSTRAINT "ConversationState_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboxTask" ADD CONSTRAINT "InboxTask_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboxTask" ADD CONSTRAINT "InboxTask_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
