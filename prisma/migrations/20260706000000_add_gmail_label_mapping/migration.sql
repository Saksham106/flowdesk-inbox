-- CreateTable
CREATE TABLE "GmailLabelMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "displayName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailLabelMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmailLabelMapping_tenantId_idx" ON "GmailLabelMapping"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailLabelMapping_tenantId_canonical_key" ON "GmailLabelMapping"("tenantId", "canonical");

-- AddForeignKey
ALTER TABLE "GmailLabelMapping" ADD CONSTRAINT "GmailLabelMapping_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
