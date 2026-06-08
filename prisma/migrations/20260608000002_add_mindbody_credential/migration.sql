CREATE TABLE IF NOT EXISTS "MindBodyCredential" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "siteId"            TEXT NOT NULL,
    "usernameEncrypted" TEXT NOT NULL,
    "passwordEncrypted" TEXT NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MindBodyCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MindBodyCredential_tenantId_key"
    ON "MindBodyCredential"("tenantId");

ALTER TABLE "MindBodyCredential"
    ADD CONSTRAINT "MindBodyCredential_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
