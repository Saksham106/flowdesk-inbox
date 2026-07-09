export type SettingsTab = { slug: string; label: string; description: string; href: string }

const TABS: Omit<SettingsTab, "href">[] = [
  { slug: "connect", label: "Connect", description: "Gmail, Outlook, health" },
  { slug: "gmail", label: "Gmail", description: "Native labels and sync" },
  { slug: "automation", label: "Automation", description: "Follow-ups and trust level" },
  { slug: "training", label: "Training", description: "Rules, voice, snippets" },
  { slug: "profile", label: "Profile", description: "Features, VIPs" },
  { slug: "data", label: "Data", description: "Apps, AI budget" },
]

export const SETTINGS_TABS: SettingsTab[] = TABS.map((t) => ({ ...t, href: `/settings/${t.slug}` }))
