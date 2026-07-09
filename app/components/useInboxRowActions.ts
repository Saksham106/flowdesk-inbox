"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { WorkflowStatus } from "@/lib/workflow-status"

export const WORKFLOW_OPTIONS: { value: string; label: string; dot: string }[] = [
  { value: "needs_reply", label: "Needs Reply", dot: "bg-red-500" },
  { value: "waiting_on",  label: "Waiting On",  dot: "bg-indigo-400" },
  { value: "read_later",  label: "Read Later",  dot: "bg-violet-400" },
  { value: "done",        label: "Done",        dot: "bg-emerald-500" },
]

type UseInboxRowActionsParams = {
  id: string
  /** Initial unread state — computed from readAt + gmailUnread in AppListColumn. Drives local optimistic state. */
  isUnread: boolean
  initialStatus: string
  attentionCategory: string | null
  workflowStatus: WorkflowStatus
}

/**
 * Owns the interactive state and API-call handlers shared by every inbox row
 * renderer (compact InboxRow, full-width MailInboxRow). Centralizing this
 * avoids duplicating the read/workflow-status/archive fetch call sites.
 */
export function useInboxRowActions({
  id,
  isUnread: initialIsUnread,
  initialStatus,
  attentionCategory: initialAttention,
  workflowStatus: initialWorkflowStatus,
}: UseInboxRowActionsParams) {
  const router = useRouter()
  // Derive isRead from the pre-computed isUnread prop (considers readAt + gmailUnread).
  // FYI classification does not affect read state — an unread FYI is still visually unread.
  const [isRead, setIsRead]         = useState(!initialIsUnread)
  const [status, setStatus]         = useState(initialStatus)
  const [attention, setAttention]   = useState(initialAttention)
  const [workflowStatus, setWorkflowStatus] = useState(initialWorkflowStatus)
  const [showAttention, setShowAtt] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null)
  const attentionBtnRef             = useRef<HTMLButtonElement>(null)
  const portalRef                   = useRef<HTMLDivElement>(null)

  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<"read" | "status" | "archive" | "attention" | null>(null)
  const isUnread = !isRead
  const isClosed = workflowStatus === "done"

  // Close attention dropdown on outside click or any scroll (covers inbox list scroll)
  useEffect(() => {
    if (!showAttention) return
    function onOutside(e: MouseEvent) {
      const t = e.target as Node
      if (attentionBtnRef.current?.contains(t) || portalRef.current?.contains(t)) return
      setShowAtt(false)
    }
    function onScroll() { setShowAtt(false) }
    document.addEventListener("mousedown", onOutside)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("mousedown", onOutside)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [showAttention])

  async function toggleRead(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (pendingAction) return
    const next = !isRead
    setIsRead(next)
    setPendingAction("read")
    try {
      const res = await fetch(`/api/conversations/${id}/read`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: next }),
      })
      if (!res.ok) {
        setIsRead(!next)
        return
      }
      router.refresh()
    } catch {
      setIsRead(!next)
    } finally {
      setPendingAction(null)
    }
  }

  async function toggleStatus(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (pendingAction) return
    const nextStatus = isClosed ? "needs_reply" : "done"
    setWorkflowStatus(nextStatus as WorkflowStatus)
    setPendingAction("status")
    try {
      const res = await fetch(`/api/conversations/${id}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: nextStatus }),
      })
      if (!res.ok) {
        setWorkflowStatus(initialWorkflowStatus)
        return
      }
      router.refresh()
    } catch {
      setWorkflowStatus(initialWorkflowStatus)
    } finally {
      setPendingAction(null)
    }
  }

  async function archiveConversation(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (pendingAction) return
    setArchiveError(null)
    const prevStatus = status
    setStatus("closed")
    setPendingAction("archive")
    try {
      const res = await fetch(`/api/conversations/${id}/archive`, { method: "PATCH" })
      if (!res.ok) {
        setStatus(prevStatus)
        setArchiveError("Archive failed")
        return
      }
      router.refresh()
    } catch {
      setStatus(prevStatus)
      setArchiveError("Archive failed")
    } finally {
      setPendingAction(null)
    }
  }

  function openAttentionDropdown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!showAttention && attentionBtnRef.current) {
      const rect = attentionBtnRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setShowAtt((v) => !v)
  }

  async function changeAttention(e: React.MouseEvent, cat: string) {
    e.preventDefault()
    e.stopPropagation()
    if (pendingAction) return
    setShowAtt(false)
    const prev = attention
    setAttention(cat)
    setWorkflowStatus(cat as WorkflowStatus)
    setPendingAction("attention")
    try {
      const res = await fetch(`/api/conversations/${id}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: cat }),
      })
      if (!res.ok) {
        setAttention(prev)
        setWorkflowStatus(initialWorkflowStatus)
        return
      }
      router.refresh()
    } catch {
      setAttention(prev)
      setWorkflowStatus(initialWorkflowStatus)
    } finally {
      setPendingAction(null)
    }
  }

  return {
    isRead,
    isUnread,
    status,
    attention,
    workflowStatus,
    isClosed,
    showAttention,
    dropdownPos,
    attentionBtnRef,
    portalRef,
    archiveError,
    pendingAction,
    toggleRead,
    toggleStatus,
    archiveConversation,
    openAttentionDropdown,
    changeAttention,
  }
}
