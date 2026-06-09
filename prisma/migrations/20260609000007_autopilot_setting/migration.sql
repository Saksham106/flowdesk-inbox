-- CreateTable
CREATE TABLE "AutopilotSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "allowedIntentsJson" JSONB,
    "maxAutoSendsPerDay" INTEGER NOT NULL DEFAULT 10,
    "disableAfterFailures" INTEGER NOT NULL DEFAULT 3,
    "currentFailures" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotSetting_tenantId_key" ON "AutopilotSetting"("tenantId");

-- AddForeignKey
ALTER TABLE "AutopilotSetting" ADD CONSTRAINT "AutopilotSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
