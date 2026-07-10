CREATE TABLE "OpenRouterUserKey" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "keyLabel" TEXT NOT NULL,
  "encryptedApiKey" TEXT NOT NULL,
  "limitUsd" DOUBLE PRECISION,
  "limitReset" TEXT,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "lastProvisionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenRouterUserKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpenRouterUserKey_userId_key" ON "OpenRouterUserKey"("userId");
CREATE UNIQUE INDEX "OpenRouterUserKey_keyHash_key" ON "OpenRouterUserKey"("keyHash");
CREATE INDEX "OpenRouterUserKey_tenantId_idx" ON "OpenRouterUserKey"("tenantId");
CREATE INDEX "OpenRouterUserKey_disabled_idx" ON "OpenRouterUserKey"("disabled");

ALTER TABLE "OpenRouterUserKey"
  ADD CONSTRAINT "OpenRouterUserKey_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpenRouterUserKey"
  ADD CONSTRAINT "OpenRouterUserKey_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiUsageEvent" ADD COLUMN "userId" TEXT;
ALTER TABLE "AiUsageEvent" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'openrouter';
ALTER TABLE "AiUsageEvent" ADD COLUMN "providerKeyHash" TEXT;
ALTER TABLE "AiUsageEvent" ADD COLUMN "providerGenerationId" TEXT;
ALTER TABLE "AiUsageEvent" ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiUsageEvent" ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiUsageEvent" ADD COLUMN "totalTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiUsageEvent" ADD COLUMN "actualCostUsd" DOUBLE PRECISION;
ALTER TABLE "AiUsageEvent" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "AiUsageEvent" ADD COLUMN "errorMessage" TEXT;

CREATE INDEX "AiUsageEvent_userId_createdAt_idx" ON "AiUsageEvent"("userId", "createdAt");
CREATE INDEX "AiUsageEvent_providerGenerationId_idx" ON "AiUsageEvent"("providerGenerationId");

ALTER TABLE "AiUsageEvent"
  ADD CONSTRAINT "AiUsageEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
