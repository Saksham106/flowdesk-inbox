ALTER TABLE "AiUsageEvent"
  ADD COLUMN IF NOT EXISTS "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "AiUsageEvent"
SET "status" = 'succeeded'
WHERE "feature" = 'reply_learning.train'
  AND "status" = 'completed';

UPDATE "AiUsageEvent"
SET "estimatedCostUsd" =
  (
    "estimatedInputTokens" *
      CASE "model"
        WHEN 'gpt-4o-mini' THEN 0.15
        WHEN 'gpt-4o' THEN 2.5
        WHEN 'gpt-5.4-mini' THEN 0.15
        WHEN 'gpt-4.1-mini' THEN 0.4
        WHEN 'gpt-4.1' THEN 2.0
        ELSE 1.0
      END
    +
    "estimatedOutputTokens" *
      CASE "model"
        WHEN 'gpt-4o-mini' THEN 0.6
        WHEN 'gpt-4o' THEN 10.0
        WHEN 'gpt-5.4-mini' THEN 0.6
        WHEN 'gpt-4.1-mini' THEN 1.6
        WHEN 'gpt-4.1' THEN 8.0
        ELSE 3.0
      END
  ) / 1000000.0
WHERE "status" = 'succeeded'
  AND "estimatedCostUsd" = 0;

CREATE TABLE "AiBudget" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "dailyLimitUsd" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  "monthlyLimitUsd" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiBudget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiBudget_tenantId_key" ON "AiBudget"("tenantId");

ALTER TABLE "AiBudget" ADD CONSTRAINT "AiBudget_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
