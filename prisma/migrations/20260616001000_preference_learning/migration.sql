-- CreateTable
CREATE TABLE "ClassificationCorrection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromDomain" TEXT NOT NULL,
    "previousAttention" TEXT,
    "newAttention" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "matchValue" TEXT NOT NULL,
    "targetAttention" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "triggerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassificationCorrection_tenantId_fromEmail_newAttention_idx" ON "ClassificationCorrection"("tenantId", "fromEmail", "newAttention");

-- CreateIndex
CREATE INDEX "ClassificationCorrection_tenantId_fromDomain_newAttention_idx" ON "ClassificationCorrection"("tenantId", "fromDomain", "newAttention");

-- CreateIndex
CREATE INDEX "ClassificationCorrection_tenantId_createdAt_idx" ON "ClassificationCorrection"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SenderRule_tenantId_matchType_matchValue_targetAttention_key" ON "SenderRule"("tenantId", "matchType", "matchValue", "targetAttention");

-- CreateIndex
CREATE INDEX "SenderRule_tenantId_status_idx" ON "SenderRule"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "ClassificationCorrection" ADD CONSTRAINT "ClassificationCorrection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderRule" ADD CONSTRAINT "SenderRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
