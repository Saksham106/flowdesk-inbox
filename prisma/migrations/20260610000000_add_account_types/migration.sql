-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('personal', 'business');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "accountType" "AccountType" NOT NULL DEFAULT 'business';

-- CreateTable
CREATE TABLE "PersonalProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "toneSummary" TEXT,
    "greetingPatterns" TEXT,
    "signoffPatterns" TEXT,
    "sentenceLengthStyle" TEXT,
    "formalityLevel" TEXT,
    "recurringPhrasesToUse" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recurringPhrasesToAvoid" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sanitizedExamples" TEXT,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "lastTrainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalProfile_tenantId_key" ON "PersonalProfile"("tenantId");

-- AddForeignKey
ALTER TABLE "PersonalProfile" ADD CONSTRAINT "PersonalProfile_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
