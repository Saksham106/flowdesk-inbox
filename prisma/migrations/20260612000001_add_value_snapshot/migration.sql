-- CreateTable
CREATE TABLE "ValueSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "weekEnding" TIMESTAMP(3) NOT NULL,
    "draftsCreated" INTEGER NOT NULL,
    "draftsSent" INTEGER NOT NULL,
    "tasksExtracted" INTEGER NOT NULL,
    "tasksClosed" INTEGER NOT NULL,
    "leadsDetected" INTEGER NOT NULL,
    "followUpsQueued" INTEGER NOT NULL,
    "approvalsDecided" INTEGER NOT NULL,
    "conversationsTriaged" INTEGER NOT NULL,
    "estimatedMinutesSaved" INTEGER NOT NULL,
    "pipelineValue" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValueSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ValueSnapshot_tenantId_weekEnding_idx" ON "ValueSnapshot"("tenantId", "weekEnding");

-- CreateIndex
CREATE UNIQUE INDEX "ValueSnapshot_tenantId_weekEnding_key" ON "ValueSnapshot"("tenantId", "weekEnding");

-- AddForeignKey
ALTER TABLE "ValueSnapshot" ADD CONSTRAINT "ValueSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
