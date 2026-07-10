"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { ASSISTANT_TABS } from "@/lib/assistant-tabs"

export default function AssistantTabNav() {
  const pathname = usePathname()
  const segment = pathname?.split("/")[2] ?? ""

  return (
    <nav
      aria-label={`Assistant sections (${ASSISTANT_TABS.length})`}
      className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm"
    >
      {ASSISTANT_TABS.map((tab) => {
        const isActive = segment === tab.slug
        return (
          <Link
            key={tab.slug}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            title={tab.description}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
