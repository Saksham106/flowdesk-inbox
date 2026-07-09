"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { getPrimaryNav } from "@/lib/app-navigation"

interface Props {
  needsReplyCount: number
  pendingApprovals: number
}

/**
 * Per-destination render config, keyed by the href from the pure nav model
 * (`getPrimaryNav`). The nav model owns the *set*, *order*, and *hrefs* of the
 * primary destinations; this lookup only owns how each one is drawn (icon,
 * short rail label, badge, and active-path matching). Adding or removing a
 * primary destination happens in the model — this map just needs an entry for
 * the new href so the rail can render it.
 */
type RailRenderConfig = {
  /** Short label under the icon (may abbreviate the nav model's label). */
  label: string
  icon: React.ReactNode
  /** Whether this pathname should light up the item as active. */
  isActive: (pathname: string) => boolean
  /** Optional badge count derived from the rail's props. */
  badge?: (props: Props) => number | undefined
}

const RAIL_CONFIG: Record<string, RailRenderConfig> = {
  "/home": {
    label: "Home",
    icon: <HomeIcon />,
    isActive: (p) => p === "/home",
  },
  "/mail": {
    label: "Mail",
    icon: <MailIcon />,
    isActive: (p) => p === "/mail" || p.startsWith("/conversations/"),
    badge: ({ needsReplyCount }) => (needsReplyCount > 0 ? needsReplyCount : undefined),
  },
  "/approvals": {
    label: "Approve",
    icon: <ApprovalsIcon />,
    isActive: (p) => p === "/approvals",
    badge: ({ pendingApprovals }) => (pendingApprovals > 0 ? pendingApprovals : undefined),
  },
  "/clean-inbox": {
    label: "Clean",
    icon: <BroomIcon />,
    isActive: (p) => p === "/clean-inbox",
  },
  "/settings": {
    label: "Settings",
    icon: <SettingsIcon />,
    isActive: (p) => p === "/settings" || p.startsWith("/settings/"),
  },
}

export default function AppRail(props: Props) {
  const pathname = usePathname()
  const primary = getPrimaryNav()

  // Settings is the last primary item and stays pinned below the spacer; the
  // rest render above it in nav-model order.
  const topItems = primary.slice(0, -1)
  const bottomItems = primary.slice(-1)

  const renderItem = (href: string) => {
    const config = RAIL_CONFIG[href]
    if (!config) return null
    return (
      <RailLink
        key={href}
        href={href}
        active={config.isActive(pathname)}
        badge={config.badge?.(props)}
        label={config.label}
      >
        {config.icon}
      </RailLink>
    )
  }

  return (
    <nav className="flex h-full w-14 shrink-0 flex-col items-center bg-slate-900 py-3 gap-1">
      {/* Logo */}
      <Link
        href="/home"
        aria-label="Go to FlowDesk home"
        title="FlowDesk home"
        className="mb-3 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-blue-500 text-sm font-black text-white transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-slate-900"
      >
        F
      </Link>

      {topItems.map((item) => renderItem(item.href))}

      <div className="flex-1" />

      {/* Ask FlowDesk — opens the global slide-over (see AskFlowDeskPanel) */}
      <button
        type="button"
        data-ask-flowdesk
        title="Ask FlowDesk"
        className="relative flex h-9 w-10 flex-col items-center justify-center gap-0.5 rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-slate-900"
      >
        <ChatIcon />
        <span className="text-[8px] font-semibold leading-none">Ask</span>
      </button>

      {bottomItems.map((item) => renderItem(item.href))}
    </nav>
  )
}

function RailLink({
  href,
  active,
  badge,
  label,
  children,
}: {
  href: string
  active: boolean
  badge?: number
  label: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={label}
      className={`relative flex h-9 w-10 flex-col items-center justify-center gap-0.5 rounded-lg transition focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-slate-900 ${
        active
          ? "bg-slate-700 text-white"
          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      }`}
    >
      {children}
      <span className="text-[8px] font-semibold leading-none">{label}</span>
      {badge !== undefined && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  )
}

function HomeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline strokeLinecap="round" strokeLinejoin="round" points="9,22 9,12 15,12 15,22" />
    </svg>
  )
}

function ApprovalsIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="5" width="18" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9 6 9-6" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  )
}

function BroomIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}
