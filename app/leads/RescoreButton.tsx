"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export function RescoreButton({ leadId }: { leadId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleRescore() {
    setLoading(true)
    try {
      await fetch(`/api/leads/${leadId}/score`, { method: "POST" })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleRescore}
      disabled={loading}
      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
      title="Re-score with AI"
      aria-label="Re-score lead"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={loading ? "animate-spin" : ""}
      >
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    </button>
  )
}
