export type AppSidebarItem = {
  label: string
  href: string
}

export type AppSidebarSection = {
  title: string
  items: AppSidebarItem[]
}

const MAIL_SECTION: AppSidebarSection = {
  title: "Mail",
  items: [
    { label: "Inbox", href: "/mail" },
    { label: "Needs Reply", href: "/mail?tab=needs_reply" },
    { label: "Waiting On", href: "/mail?tab=waiting_on" },
    { label: "Read Later", href: "/mail?tab=read_later" },
    { label: "Done", href: "/mail?status=closed" },
  ],
}

const ASSISTANT_SECTION: AppSidebarSection = {
  title: "Assistant",
  items: [
    { label: "Rules", href: "/assistant/rules" },
    { label: "Test Rules", href: "/assistant/test-rules" },
    { label: "History", href: "/assistant/history" },
    { label: "Settings", href: "/assistant/settings" },
  ],
}

const CLEANUP_SECTION: AppSidebarSection = {
  title: "Cleanup",
  items: [
    { label: "Bulk Archive", href: "/clean-inbox" },
    { label: "Bulk Unsubscribe", href: "/clean-inbox/unsubscribe" },
    { label: "Analytics", href: "/clean-inbox/analytics" },
  ],
}

const TOOLS_SECTION: AppSidebarSection = {
  title: "Tools",
  items: [],
}

/**
 * Which expanded-sidebar section (if any) applies to the given pathname.
 * Returns null for pages that render their own sub-navigation (Settings)
 * or have none (Home, Approvals).
 *
 * Note: this only matches on pathname (Next.js App Router's usePathname()
 * never includes the query string). Several Mail items (Needs Reply,
 * Waiting On, Read Later, Done, Drafts, Sent) share the "/mail" pathname
 * and differ only by query string, so per-item active-state highlighting
 * for those items will need the consuming component to also inspect
 * useSearchParams(), not just pathname, when that UI is built.
 */
export function getSidebarSection(pathname: string): AppSidebarSection | null {
  if (pathname === "/mail" || pathname.startsWith("/conversations/")) {
    return MAIL_SECTION
  }
  if (pathname === "/assistant" || pathname.startsWith("/assistant/")) {
    return ASSISTANT_SECTION
  }
  if (pathname === "/clean-inbox" || pathname.startsWith("/clean-inbox/")) {
    return CLEANUP_SECTION
  }
  if (pathname === "/tools" || pathname.startsWith("/tools/")) {
    return TOOLS_SECTION
  }
  return null
}
