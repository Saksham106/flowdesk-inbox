CREATE TABLE IF NOT EXISTS "GoogleCalendarCredential" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "email"                 TEXT NOT NULL,
    "accessTokenEncrypted"  TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiry"           TIMESTAMP(3),
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleCalendarCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoogleCalendarCredential_tenantId_email_key"
    ON "GoogleCalendarCredential"("tenantId", "email");

ALTER TABLE "GoogleCalendarCredential"
    ADD CONSTRAINT "GoogleCalendarCredential_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
