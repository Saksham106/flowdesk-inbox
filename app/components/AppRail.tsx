"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

interface Props {
  needsReplyCount: number
  accountType: string | null
}

const BUSINESS_OVERFLOW = [
  { label: "Leads", href: "/leads" },
  { label: "Approvals", href: "/approvals" },
  { label: "Risk Radar", href: "/risk-radar" },
  { label: "Reports", href: "/reports" },
  { label: "Meetings", href: "/meetings" },
  { label: "Knowledge Base", href: "/knowledge-base" },
  { label: "Audit", href: "/audit" },
]

export default function AppRail({ needsReplyCount, accountType }: Props) {
  const pathname = usePathname()
  const [overflowOpen, setOverflowOpen] = useState(false)

  const isEmailSection =
    pathname === "/inbox" || pathname.startsWith("/conversations/")
  const isTasks = pathname === "/tasks"
  const isSearch = pathname === "/search"
  const isSettings = pathname === "/settings"
  const isBusiness = accountType === "business"

  return (
    <nav className="flex h-full w-14 shrink-0 flex-col items-center bg-slate-900 py-3 gap-1">
      {/* Logo */}
      <Link
        href="/inbox"
        aria-label="Go to FlowDesk home"
        title="FlowDesk home"
        className="mb-3 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-blue-500 text-sm font-black text-white transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-slate-900"
      >
        F
      </Link>

      {/* Home / email section */}
      <RailLink
        href="/inbox"
        active={isEmailSection}
        badge={needsReplyCount > 0 ? needsReplyCount : undefined}
        label="Home"
      >
        <HomeIcon />
      </RailLink>

      {/* Tasks */}
      <RailLink href="/tasks" active={isTasks} label="Tasks">
        <TasksIcon />
      </RailLink>

      {/* Search */}
      <RailLink href="/search" active={isSearch} label="Search">
        <SearchIcon />
      </RailLink>

      <div className="flex-1" />

      {/* Business overflow */}
      {isBusiness && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOverflowOpen((v) => !v)}
            className={`flex h-9 w-10 flex-col items-center justify-center gap-0.5 rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 ${overflowOpen ? "bg-slate-800 text-slate-200" : ""}`}
            aria-label="More"
          >
            <span className="block h-1 w-1 rounded-full bg-current" />
            <span className="block h-1 w-1 rounded-full bg-current" />
            <span className="block h-1 w-1 rounded-full bg-current" />
          </button>
          {overflowOpen && (
            <div className="absolute bottom-full left-full z-50 mb-1 ml-1 min-w-40 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl">
              {BUSINESS_OVERFLOW.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOverflowOpen(false)}
                  className="block px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Settings */}
      <RailLink href="/settings" active={isSettings} label="Settings">
        <SettingsIcon />
      </RailLink>
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
      className={`relative flex h-9 w-10 flex-col items-center justify-center gap-0.5 rounded-lg transition ${
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

function TasksIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <polyline strokeLinecap="round" strokeLinejoin="round" points="9 11 12 14 22 4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" strokeLinecap="round" />
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
