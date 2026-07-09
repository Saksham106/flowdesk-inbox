"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { SETTINGS_TABS } from "@/lib/settings-tabs"

export default function SettingsTabNav() {
  const pathname = usePathname()

  return (
    <aside className="lg:sticky lg:top-4 lg:self-start">
      <nav
        aria-label={`Settings sections (${SETTINGS_TABS.length})`}
        className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm"
      >
        <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Settings
        </p>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
          {SETTINGS_TABS.map((tab) => {
            const segment = pathname?.split("/")[2] ?? ""
            const isActive = segment === tab.slug
            return (
              <Link
                key={tab.slug}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${
                  isActive ? "bg-slate-100" : ""
                }`}
              >
                <span className="block font-medium text-slate-900">{tab.label}</span>
                <span className="block text-xs text-slate-500">{tab.description}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}
