-- CreateTable
CREATE TABLE "PersonMemory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "lastContactAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "preferences" TEXT,
    "openQuestions" TEXT,
    "promisedActions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonMemory_contactId_key" ON "PersonMemory"("contactId");

-- CreateIndex
CREATE INDEX "PersonMemory_tenantId_idx" ON "PersonMemory"("tenantId");

-- AddForeignKey
ALTER TABLE "PersonMemory" ADD CONSTRAINT "PersonMemory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonMemory" ADD CONSTRAINT "PersonMemory_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
