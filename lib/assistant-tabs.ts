export type AssistantTab = { slug: string; label: string; description: string; href: string }

const TABS: Omit<AssistantTab, "href">[] = [
  { slug: "rules", label: "Rules", description: "Active, draft, and learned rules" },
  { slug: "test-rules", label: "Test Rules", description: "Dry-run a rule before enabling it" },
  { slug: "history", label: "History", description: "Rule versions and audit events" },
  { slug: "settings", label: "Settings", description: "Plain-English training" },
]

export const ASSISTANT_TABS: AssistantTab[] = TABS.map((t) => ({ ...t, href: `/assistant/${t.slug}` }))
