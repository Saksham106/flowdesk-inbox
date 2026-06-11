"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

export default function AutoDraftTrigger({ conversationId }: { conversationId: string }) {
  const router = useRouter()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    fetch(`/api/conversations/${conversationId}/draft/suggest`, { method: "POST" })
      .then(() => router.refresh())
      .catch(() => null)
  }, [conversationId, router])

  return null
}
