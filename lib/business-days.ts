// Pure business-day math for the waiting-on / follow-up lifecycle. Kept free
// of prisma imports so UI components can share it with the server-side code.

/** Default follow-up delay when a tenant has no FollowUpSetting row. */
export const DEFAULT_FOLLOW_UP_BUSINESS_DAYS = 3

export function addBusinessDays(start: Date, businessDays: number): Date {
  const result = new Date(start)
  let remaining = businessDays
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1)
    const day = result.getUTCDay()
    if (day !== 0 && day !== 6) remaining--
  }
  return result
}

/**
 * When a waiting-on conversation becomes follow-up due. The delay is the
 * tenant's FollowUpSetting.staleAfterDays (interpreted as business days,
 * minimum 1), defaulting to DEFAULT_FOLLOW_UP_BUSINESS_DAYS.
 */
export function followUpDueAt(waitingSince: Date, staleAfterBusinessDays: number): Date {
  return addBusinessDays(waitingSince, Math.max(1, staleAfterBusinessDays))
}
