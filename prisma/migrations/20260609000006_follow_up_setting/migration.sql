-- CreateTable
CREATE TABLE "FollowUpSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "staleAfterDays" INTEGER NOT NULL DEFAULT 3,
    "maxFollowUpsPerConversation" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpSetting_tenantId_key" ON "FollowUpSetting"("tenantId");

-- AddForeignKey
ALTER TABLE "FollowUpSetting" ADD CONSTRAINT "FollowUpSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
