-- Add LLM-based scoring fields to Lead model

ALTER TABLE "Lead" ADD COLUMN "scoreExplanation" TEXT;
ALTER TABLE "Lead" ADD COLUMN "estimatedValue" INTEGER;
ALTER TABLE "Lead" ADD COLUMN "scoredAt" TIMESTAMP(3);
