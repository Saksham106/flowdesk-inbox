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
 * B2C: one nav model for everyone. There is no "business account" — every
 * user gets the same baseline navigation. The sales/CRM cluster (Leads, Reports,
 * Risk Radar, Meetings, Knowledge Base) is an opt-in capability that resurfaces
 * in the "More" menu only when the tenant has Sales & CRM mode enabled.
 *
 * `primary` items are the 5 rail destinations and always render; `secondary`
 * items (demoted: Tasks, Activity) collapse into a "More" menu.
 */
const PRIMARY_NAV: AppNavigationItem[] = [
  { label: "Home", href: "/home" },
  { label: "Mail", href: "/mail" },
  { label: "Approvals", href: "/approvals" },
  { label: "Clean", href: "/clean-inbox" },
  { label: "Settings", href: "/settings" },
]

const SECONDARY_NAV: AppNavigationItem[] = [
  { label: "Tasks", href: "/tasks" },
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

export function getPrimaryNav(): AppNavigationItem[] {
  return PRIMARY_NAV
}

export function getInboxNavigation(capabilities?: NavCapabilities): InboxNavigation {
  const secondary = capabilities?.salesCrm
    ? [...SECONDARY_NAV, ...SALES_CRM_SECONDARY]
    : SECONDARY_NAV
  return {
    primary: PRIMARY_NAV,
    secondary,
  }
}
