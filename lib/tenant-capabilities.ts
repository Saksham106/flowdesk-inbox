import type { AccountMode } from "@/lib/account-mode"

/**
 * B2C capability model. Replaces the personal/business account *identity* with
 * opt-in capabilities. Today there is a single capability — "Sales & CRM mode" —
 * which gates everything the old "business" account gated (leads, sales/support
 * signals, revenue-at-risk, reports, business prompt framing). Off by default so
 * every new user gets the clean personal baseline.
 *
 * The source of truth is `Tenant.salesCrmEnabled`. The legacy internal
 * `personal`/`business` mode that prompts, sync, and lead/sales code still branch
 * on is now *derived* from this capability via `accountModeFor`, so downstream
 * logic didn't have to change.
 */

export type TenantCapabilities = {
  /** Leads, sales/support signals, revenue-at-risk, reports, business framing. */
  salesCrm: boolean
}

type CapabilitySource = { salesCrmEnabled?: boolean | null } | null | undefined

export function salesCrmEnabled(tenant: CapabilitySource): boolean {
  return tenant?.salesCrmEnabled === true
}

export function resolveCapabilities(tenant: CapabilitySource): TenantCapabilities {
  return { salesCrm: salesCrmEnabled(tenant) }
}

/**
 * Bridge to the legacy internal mode. Sales/CRM on → "business", off →
 * "personal". Prefer `resolveCapabilities`/`salesCrmEnabled` in new code; this
 * exists so the many functions that still take an `AccountMode` keep working
 * while the capability flag becomes the source of truth.
 */
export function accountModeFor(tenant: CapabilitySource): AccountMode {
  return salesCrmEnabled(tenant) ? "business" : "personal"
}
