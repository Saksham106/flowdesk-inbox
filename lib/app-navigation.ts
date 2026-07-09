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
 * The 6 primary destinations shown in the desktop rail and mobile nav.
 * Home is not one of them — the `F` logo at the top of the desktop rail is
 * the sole Home affordance, so it is never duplicated as a nav item.
 * Assistant surfaces AI rules (previously buried in Settings > Training).
 * Approvals keeps its own slot — a trust-critical surface, not folded into
 * Mail's sidebar. Tools is a placeholder landing page for now.
 */
const PRIMARY_NAV: AppNavigationItem[] = [
  { label: "Mail", href: "/mail" },
  { label: "Assistant", href: "/assistant" },
  { label: "Approvals", href: "/approvals" },
  { label: "Clean", href: "/clean-inbox" },
  { label: "Tools", href: "/tools" },
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
