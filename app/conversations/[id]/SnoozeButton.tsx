"use client"

import { useState } from "react"
import SnoozeModal from "./SnoozeModal"

export default function SnoozeButton({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
      >
        💤 Snooze
      </button>
      {open && <SnoozeModal conversationId={conversationId} onClose={() => setOpen(false)} />}
    </>
  )
}
