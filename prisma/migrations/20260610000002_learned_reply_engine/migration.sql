-- CreateEnum
CREATE TYPE "ReplyProfileType" AS ENUM ('personal', 'business');

-- CreateTable
CREATE TABLE "LearnedReplyProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT,
    "profileType" "ReplyProfileType" NOT NULL,
    "styleSummaryJson" JSONB NOT NULL,
    "exampleSnippetsJson" JSONB,
    "sourceStatsJson" JSONB,
    "promptVersion" TEXT NOT NULL,
    "lastTrainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnedReplyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "estimatedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearnedReplyProfile_tenantId_profileType_idx" ON "LearnedReplyProfile"("tenantId", "profileType");

-- CreateIndex
CREATE INDEX "LearnedReplyProfile_channelId_idx" ON "LearnedReplyProfile"("channelId");

-- CreateIndex
CREATE INDEX "AiUsageEvent_tenantId_createdAt_idx" ON "AiUsageEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_feature_idx" ON "AiUsageEvent"("feature");

-- AddForeignKey
ALTER TABLE "LearnedReplyProfile" ADD CONSTRAINT "LearnedReplyProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnedReplyProfile" ADD CONSTRAINT "LearnedReplyProfile_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
