export type AccountTypeValue = "personal" | "business" | string | null | undefined

export type AppNavigationItem = {
  label: string
  href: string
}

export type InboxNavigation = {
  primary: AppNavigationItem[]
  secondary: AppNavigationItem[]
}

const PERSONAL_PRIMARY: AppNavigationItem[] = [
  { label: "Digest", href: "/digest" },
  { label: "Tasks", href: "/tasks" },
  { label: "Settings", href: "/settings" },
]

const BUSINESS_PRIMARY: AppNavigationItem[] = [
  { label: "Digest", href: "/digest" },
  { label: "Tasks", href: "/tasks" },
]

const BUSINESS_SECONDARY: AppNavigationItem[] = [
  { label: "Leads", href: "/leads" },
  { label: "Approvals", href: "/approvals" },
  { label: "Risk Radar", href: "/risk-radar" },
  { label: "Reports", href: "/reports" },
  { label: "Meetings", href: "/meetings" },
  { label: "Knowledge Base", href: "/knowledge-base" },
  { label: "Audit", href: "/audit" },
  { label: "Settings", href: "/settings" },
]

export function getInboxNavigation(accountType: AccountTypeValue): InboxNavigation {
  if (accountType === "business") {
    return {
      primary: BUSINESS_PRIMARY,
      secondary: BUSINESS_SECONDARY,
    }
  }

  return {
    primary: PERSONAL_PRIMARY,
    secondary: [],
  }
}
