export type CleanupTab = { slug: string; label: string; href: string }

export const CLEANUP_TABS: CleanupTab[] = [
  { slug: "archive", label: "Bulk Archive", href: "/clean-inbox" },
  { slug: "unsubscribe", label: "Bulk Unsubscribe", href: "/clean-inbox/unsubscribe" },
  { slug: "analytics", label: "Analytics", href: "/clean-inbox/analytics" },
]
