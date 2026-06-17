-- CreateTable
CREATE TABLE "AgentRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "conditionsJson" JSONB NOT NULL,
    "actionJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'plain_english',
    "previewCount" INTEGER,
    "conflictsWith" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRule_tenantId_status_idx" ON "AgentRule"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "AgentRule" ADD CONSTRAINT "AgentRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
