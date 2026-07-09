"use client"

import type { InboxListItem } from "@/app/components/ClientFilteredInboxList"
import MailInboxRowWithSnooze from "@/app/components/MailInboxRowWithSnooze"

type Props = {
  items: InboxListItem[]
  emptyMessage: string
}

export default function MailInboxTable({ items, emptyMessage }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-16 text-sm text-slate-400">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {items.map((item) => (
        <MailInboxRowWithSnooze key={item.id} {...item} />
      ))}
    </div>
  )
}
