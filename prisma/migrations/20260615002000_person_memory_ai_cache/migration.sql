ALTER TABLE "PersonMemory"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'deterministic',
ADD COLUMN "contentHash" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "llmSyncedAt" TIMESTAMP(3);

CREATE INDEX "PersonMemory_contentHash_idx" ON "PersonMemory"("contentHash");
