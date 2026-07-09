"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { getSidebarSection } from "@/lib/app-sidebar"

const STORAGE_KEY = "flowdesk.appSidebar.collapsed"

export default function AppSidebar() {
  const pathname = usePathname()
  const section = getSidebarSection(pathname ?? "")
  const [collapsed, setCollapsed] = useState(false)
  const [hasLoadedStored, setHasLoadedStored] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === "true") setCollapsed(true)
    } catch {
      // localStorage unavailable — fall back to expanded
    }
    setHasLoadedStored(true)
  }, [])

  useEffect(() => {
    if (!hasLoadedStored) return
    try {
      window.localStorage.setItem(STORAGE_KEY, String(collapsed))
    } catch {
      // ignore write failures (private browsing, quota)
    }
  }, [collapsed, hasLoadedStored])

  if (!section) return null

  return (
    <aside
      className={`hidden shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col ${
        collapsed ? "w-12" : "w-52"
      } transition-[width] duration-150`}
    >
      <div className="flex items-center justify-between px-3 py-3">
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {section.title}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>
      {section.items.length > 0 && (
        <nav className="flex flex-col gap-0.5 px-2 pb-3">
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              className="truncate rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {collapsed ? item.label.slice(0, 1) : item.label}
            </Link>
          ))}
        </nav>
      )}
      {section.items.length === 0 && !collapsed && (
        <p className="px-3 text-sm text-slate-400">Coming soon</p>
      )}
    </aside>
  )
}
