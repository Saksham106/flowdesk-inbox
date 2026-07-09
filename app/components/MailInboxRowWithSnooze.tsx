"use client"

import { useState } from "react"
import MailInboxRow from "./MailInboxRow"
import SnoozeModal from "@/app/conversations/[id]/SnoozeModal"
import type { WorkflowStatus } from "@/lib/workflow-status"

type MailInboxRowWithSnoozeProps = {
  id: string
  href: string
  isSelected: boolean
  isUnread: boolean
  isFyi: boolean
  isClosed: boolean
  name: string
  subject?: string | null
  snippet: string
  timeLabel: string
  statusDot: string
  statusText: string
  statusLabel: string
  hasDraft: boolean
  initialStatus: string
  attentionCategory: string | null
  contentType?: string | null
  isPersonal: boolean
  isGmail: boolean
  isVip?: boolean
  vipLabel?: string | null
  snoozeUntil?: string | null
  workflowStatus: WorkflowStatus
}

export default function MailInboxRowWithSnooze(props: MailInboxRowWithSnoozeProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)

  return (
    <>
      <MailInboxRow
        {...props}
        onSnooze={() => setSnoozeOpen(true)}
      />
      {snoozeOpen && (
        <SnoozeModal
          conversationId={props.id}
          onClose={() => setSnoozeOpen(false)}
        />
      )}
    </>
  )
}
