"use client"

import { useState } from "react"
import InboxRow from "./InboxRow"
import SnoozeModal from "@/app/conversations/[id]/SnoozeModal"

type InboxRowWithSnoozeProps = {
  id: string
  href: string
  isSelected: boolean
  isUnread: boolean
  isFyi: boolean
  isClosed: boolean
  name: string
  snippet: string
  timeLabel: string
  statusDot: string
  statusText: string
  statusLabel: string
  hasDraft: boolean
  initialReadAt: boolean
  initialStatus: string
  attentionCategory: string | null
  isPersonal: boolean
  isGmail: boolean
  isVip?: boolean
  vipLabel?: string | null
  snoozeUntil?: string | null
}

export default function InboxRowWithSnooze(props: InboxRowWithSnoozeProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)

  return (
    <>
      <InboxRow
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
