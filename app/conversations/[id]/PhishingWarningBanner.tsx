"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function PhishingWarningBanner({
  conversationId,
  verdict,
}: {
  conversationId: string
  verdict: "suspicious" | "likely_phishing"
}) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const isHighRisk = verdict === "likely_phishing"

  async function markSafe() {
    await fetch(`/api/conversations/${conversationId}/phishing-safe`, { method: "POST" })
    setDismissed(true)
    router.refresh()
  }

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${isHighRisk ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <span className="mt-0.5 text-lg">🛡</span>
      <div className="flex-1">
        <p className="font-medium">
          {isHighRisk
            ? "This email shows strong signs of phishing — do not click links or share personal information."
            : "This email has some suspicious characteristics — proceed with caution."}
        </p>
      </div>
      <button onClick={markSafe} className="shrink-0 text-xs underline opacity-70 hover:opacity-100">
        Mark as safe
      </button>
    </div>
  )
}
