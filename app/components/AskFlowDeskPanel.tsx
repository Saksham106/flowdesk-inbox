"use client"

import { useEffect, useRef, useState } from "react"
import ChatInterface from "@/app/chat/ChatInterface"
import { FOCUSABLE_SELECTOR, focusTrapTarget, isAskFlowDeskClick } from "@/lib/ask-flowdesk"

/**
 * Global "Ask FlowDesk" slide-over. Opens when any element matching
 * `[data-ask-flowdesk]` is clicked (see the rail trigger in AppRail.tsx).
 * Reuses the existing ChatInterface component, which talks to the same
 * `/api/chat` endpoint as the standalone /chat page — no second chat
 * backend is introduced here.
 */
export default function AskFlowDeskPanel() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // Open on any click that lands on (or inside) an [data-ask-flowdesk] element.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (isAskFlowDeskClick(target)) {
        triggerRef.current = target.closest("[data-ask-flowdesk]") as HTMLElement
        setOpen(true)
      }
    }
    document.addEventListener("click", handleClick)
    return () => document.removeEventListener("click", handleClick)
  }, [])

  // Escape closes the panel; Tab/Shift+Tab is trapped inside it so keyboard
  // focus can't wander back into the (aria-modal) page behind the dialog.
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false)
        return
      }
      if (e.key !== "Tab") return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      const next = focusTrapTarget(
        focusable,
        document.activeElement as HTMLElement | null,
        e.shiftKey
      )
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open])

  // Focus the panel on open; restore focus to the trigger on close.
  useEffect(() => {
    if (open) {
      panelRef.current?.focus()
    } else {
      triggerRef.current?.focus()
    }
  }, [open])

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Slide-over panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ask FlowDesk"
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md transform flex-col bg-white shadow-2xl transition-transform duration-200 ease-in-out focus:outline-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Ask FlowDesk</h2>
            <p className="text-xs text-slate-400">Ask questions about your emails</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close Ask FlowDesk"
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatInterface />
        </div>
      </div>
    </>
  )
}
