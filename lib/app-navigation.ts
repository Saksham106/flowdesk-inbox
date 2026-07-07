export type AccountTypeValue = "personal" | "business" | string | null | undefined

export type AppNavigationItem = {
  label: string
  href: string
}

export type InboxNavigation = {
  primary: AppNavigationItem[]
  secondary: AppNavigationItem[]
}

/**
 * B2C: one control room for everyone. There is no "business account" — every
 * user gets the same navigation and can later opt into extra capabilities
 * (Leads, Risk Radar, Reports) rather than being locked into an account type.
 *
 * `primary` items always render; `secondary` items collapse into a "More" menu.
 * Supervision surfaces (Approvals, Activity) are first-class for all users.
 */
const CONTROL_ROOM_PRIMARY: AppNavigationItem[] = [
  { label: "Digest", href: "/digest" },
  { label: "Tasks", href: "/tasks" },
  { label: "Settings", href: "/settings" },
]

const CONTROL_ROOM_SECONDARY: AppNavigationItem[] = [
  { label: "Approvals", href: "/approvals" },
  { label: "Activity", href: "/audit" },
  { label: "Meetings", href: "/meetings" },
  { label: "Knowledge Base", href: "/knowledge-base" },
]

/**
 * Navigation for the control room. The `accountType` argument is retained so
 * callers don't have to change during the B2C transition, but it no longer
 * affects the result — the full removal happens in the accountType pivot PR.
 */
export function getInboxNavigation(accountType?: AccountTypeValue): InboxNavigation {
  void accountType // B2C: intentionally ignored; one control room for everyone.
  return {
    primary: CONTROL_ROOM_PRIMARY,
    secondary: CONTROL_ROOM_SECONDARY,
  }
}
