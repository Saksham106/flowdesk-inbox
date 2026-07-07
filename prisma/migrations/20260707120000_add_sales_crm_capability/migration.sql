-- B2C pivot Phase 2: replace the personal/business account identity with an
-- opt-in "Sales & CRM mode" capability.

-- New capability flag, off by default (clean B2C baseline for new tenants).
ALTER TABLE "Tenant" ADD COLUMN "salesCrmEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Preserve existing behavior: tenants that were "business" keep sales/CRM on so
-- their leads, sales signals, reports, and business prompt framing don't vanish.
UPDATE "Tenant" SET "salesCrmEnabled" = true WHERE "accountType" = 'business';

-- The "accountType" column and the AccountType enum are now deprecated and no
-- longer read for gating. They are dropped in a follow-up migration once no code
-- references them.
