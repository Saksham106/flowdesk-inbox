-- Drop the deprecated personal/business tenant identity. Sales & CRM mode is
-- now represented solely by Tenant.salesCrmEnabled.
ALTER TABLE "Tenant" DROP COLUMN "accountType";

DROP TYPE "AccountType";
