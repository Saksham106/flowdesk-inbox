-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "AgentJob" (
    "id"               TEXT NOT NULL,
    "tenantId"         TEXT NOT NULL,
    "conversationId"   TEXT NOT NULL,
    "trigger"          TEXT NOT NULL,
    "status"           "AgentJobStatus" NOT NULL DEFAULT 'pending',
    "intent"           TEXT,
    "confidence"       DOUBLE PRECISION,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "error"            TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt"        TIMESTAMP(3),
    "completedAt"      TIMESTAMP(3),

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id"          TEXT NOT NULL,
    "agentJobId"  TEXT NOT NULL,
    "toolName"    TEXT NOT NULL,
    "inputJson"   JSONB NOT NULL,
    "outputJson"  JSONB,
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentJob_tenantId_createdAt_idx" ON "AgentJob"("tenantId", "createdAt");
CREATE INDEX "AgentJob_conversationId_idx" ON "AgentJob"("conversationId");
CREATE INDEX "AgentToolCall_agentJobId_idx" ON "AgentToolCall"("agentJobId");

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_agentJobId_fkey"
    FOREIGN KEY ("agentJobId") REFERENCES "AgentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wire ApprovalRequest.agentJobId → AgentJob
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_agentJobId_fkey"
    FOREIGN KEY ("agentJobId") REFERENCES "AgentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
