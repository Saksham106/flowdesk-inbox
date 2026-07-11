CREATE TABLE "WritingPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "forbidEmDash" BOOLEAN NOT NULL DEFAULT false,
    "preferredGreetings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "avoidedPhrases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "preferredSignoffs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "formality" TEXT,
    "replyLength" TEXT,
    "customInstruction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritingPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WritingPreference_tenantId_key" ON "WritingPreference"("tenantId");

ALTER TABLE "WritingPreference" ADD CONSTRAINT "WritingPreference_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
