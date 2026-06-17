CREATE TABLE "VipContact" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "domain" TEXT,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VipContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VipContact_tenantId_email_key" ON "VipContact"("tenantId", "email");
CREATE INDEX "VipContact_tenantId_idx" ON "VipContact"("tenantId");

ALTER TABLE "VipContact" ADD CONSTRAINT "VipContact_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
