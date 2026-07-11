"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CLEANUP_TABS } from "@/lib/cleanup-tabs"
import type { CleanupRange } from "@/lib/cleanup-range"

export default function CleanupTabNav({ range = "quarter" }: { range?: CleanupRange }) {
  const pathname = usePathname()

  return (
    <nav className="mb-6 flex gap-1 border-b border-slate-200">
      {CLEANUP_TABS.map((tab) => {
        const isActive = pathname === tab.href
        return (
          <Link
            key={tab.slug}
            href={`${tab.href}?range=${range}`}
            aria-current={isActive ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              isActive ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
