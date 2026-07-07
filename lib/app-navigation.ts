export type AppNavigationItem = {
  label: string
  href: string
}

export type InboxNavigation = {
  primary: AppNavigationItem[]
  secondary: AppNavigationItem[]
}

export type NavCapabilities = {
  /** Sales & CRM mode — surfaces Leads, Reports, Risk Radar, Meetings, KB. */
  salesCrm?: boolean
}

/**
 * B2C: one control room for everyone. There is no "business account" — every
 * user gets the same baseline navigation. The sales/CRM cluster (Leads, Reports,
 * Risk Radar, Meetings, Knowledge Base) is an opt-in capability that resurfaces
 * in the "More" menu only when the tenant has Sales & CRM mode enabled.
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
]

/** Opt-in Sales & CRM surfaces, shown only when the capability is enabled. */
const SALES_CRM_SECONDARY: AppNavigationItem[] = [
  { label: "Leads", href: "/leads" },
  { label: "Reports", href: "/reports" },
  { label: "Risk Radar", href: "/risk-radar" },
  { label: "Meetings", href: "/meetings" },
  { label: "Knowledge Base", href: "/knowledge-base" },
]

export function getInboxNavigation(capabilities?: NavCapabilities): InboxNavigation {
  const secondary = capabilities?.salesCrm
    ? [...CONTROL_ROOM_SECONDARY, ...SALES_CRM_SECONDARY]
    : CONTROL_ROOM_SECONDARY
  return {
    primary: CONTROL_ROOM_PRIMARY,
    secondary,
  }
}
