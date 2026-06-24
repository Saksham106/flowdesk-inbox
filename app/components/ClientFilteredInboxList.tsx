"use client"

import { useMemo, useState } from "react"
import type { ReactNode } from "react"

import InboxRowWithSnooze from "@/app/components/InboxRowWithSnooze"
import InboxScrollContainer from "@/app/components/InboxScrollContainer"
import SearchInput from "@/app/inbox/SearchInput"

export type InboxListItem = {
  id: string
  href: string
  isSelected: boolean
  /** True when the conversation has not been read (considers both readAt and gmailUnread). Used as initial state for the row. */
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
  initialStatus: string
  attentionCategory: string | null
  isPersonal: boolean
  isGmail: boolean
  isVip?: boolean
  vipLabel?: string | null
  snoozeUntil?: string | null
  searchText: string
}

export default function ClientFilteredInboxList({
  items,
  defaultQuery,
  emptyMessage,
  scrollKey,
  className,
  headerEnd,
  filters,
}: {
  items: InboxListItem[]
  defaultQuery: string
  emptyMessage: string
  scrollKey: string
  className: string
  headerEnd: ReactNode
  filters: ReactNode
}) {
  const [localQuery, setLocalQuery] = useState(defaultQuery)
  const normalizedQuery = localQuery.trim().toLowerCase()
  const visibleItems = useMemo(() => {
    if (!normalizedQuery) return items
    return items.filter((item) => item.searchText.includes(normalizedQuery))
  }, [items, normalizedQuery])

  return (
    <div className={`flex h-full flex-col border-r border-slate-200 bg-white ${className}`}>
      <div className="border-b border-slate-100 px-3 pb-2 pt-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="pt-1 text-sm font-semibold text-slate-900">Inbox</p>
          {headerEnd}
        </div>
        <SearchInput defaultValue={defaultQuery} onLocalQueryChange={setLocalQuery} />
        {filters}
      </div>
      <InboxScrollContainer scrollKey={scrollKey} className="flex-1 overflow-y-auto">
        {visibleItems.length === 0 ? (
          <p className="px-4 py-8 text-xs text-slate-400">{emptyMessage}</p>
        ) : (
          visibleItems.map((item) => (
            <InboxRowWithSnooze
              key={item.id}
              id={item.id}
              href={item.href}
              isSelected={item.isSelected}
              isUnread={item.isUnread}
              isFyi={item.isFyi}
              isClosed={item.isClosed}
              name={item.name}
              snippet={item.snippet}
              timeLabel={item.timeLabel}
              statusDot={item.statusDot}
              statusText={item.statusText}
              statusLabel={item.statusLabel}
              hasDraft={item.hasDraft}
              initialStatus={item.initialStatus}
              attentionCategory={item.attentionCategory}
              isPersonal={item.isPersonal}
              isGmail={item.isGmail}
              isVip={item.isVip}
              vipLabel={item.vipLabel}
              snoozeUntil={item.snoozeUntil}
            />
          ))
        )}
      </InboxScrollContainer>
    </div>
  )
}
