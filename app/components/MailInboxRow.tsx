"use client"

import { createPortal } from "react-dom"
import Link from "next/link"
import type { WorkflowStatus } from "@/lib/workflow-status"
import { ContentTypeBadge } from "@/app/components/badges"
import { useInboxRowActions, FLOWDESK_LABEL_OPTIONS } from "@/app/components/useInboxRowActions"

type MailInboxRowProps = {
  id: string
  href: string
  isSelected: boolean
  /** Initial unread state — computed from readAt + gmailUnread in AppListColumn. Drives local optimistic state. */
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
  isVip?: boolean
  vipLabel?: string | null
  onSnooze?: () => void
  snoozeUntil?: string | null
  attentionCategory: string | null
  contentType?: string | null
  isPersonal: boolean
  supportsMailboxActions: boolean
  workflowStatus: WorkflowStatus
}

/**
 * Full-width, genuinely columnar inbox row for the /mail table layout.
 * Unlike the compact InboxRow (stacked name/snippet/pills in a narrow
 * column), this lays sender, subject, snippet, pills, and timestamp out as
 * horizontal columns appropriate for full page width. All interactive state
 * and API calls are delegated to useInboxRowActions — the same hook InboxRow
 * uses — so no fetch call site is duplicated between the two row renderers.
 */
export default function MailInboxRow({
  id,
  href,
  isSelected,
  isUnread: initialIsUnread,
  name,
  subject,
  snippet,
  timeLabel,
  statusDot,
  statusText,
  statusLabel,
  hasDraft,
  initialStatus,
  isVip,
  vipLabel,
  onSnooze,
  snoozeUntil,
  attentionCategory: initialAttention,
  contentType,
  isPersonal,
  supportsMailboxActions,
  workflowStatus: initialWorkflowStatus,
}: MailInboxRowProps) {
  const {
    isRead,
    isUnread,
    label,
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
    changeLabel,
  } = useInboxRowActions({
    id,
    isUnread: initialIsUnread,
    initialStatus,
    attentionCategory: initialAttention,
    contentType,
    workflowStatus: initialWorkflowStatus,
    hasDraft,
  })

  const subjectLine = subject && subject.trim() ? subject : snippet

  return (
    <div className="group relative w-full border-b border-slate-100 last:border-b-0">
      <Link
        href={href}
        className={`grid w-full grid-cols-[16px_180px_minmax(0,1fr)_auto_72px] items-center gap-3 px-4 py-2.5 transition ${
          isSelected
            ? "border-l-2 border-l-[var(--color-accent)] bg-[var(--color-accent-soft)]"
            : isUnread
              ? "hover:bg-[var(--color-accent-soft)]/60"
              : "hover:bg-slate-50"
        }`}
      >
        {/* Unread indicator */}
        <span className="flex items-center justify-center">
          {isUnread && (
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
          )}
        </span>

        {/* Sender */}
        <div className="flex min-w-0 items-center gap-1.5">
          <p
            className={`min-w-0 truncate text-sm ${
              isUnread
                ? "font-bold text-slate-900"
                : workflowStatus === "done"
                  ? "font-normal text-slate-500"
                  : "font-semibold text-slate-800"
            }`}
          >
            {name}
          </p>
          {isVip && (
            <span className="ml-1 inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
              ⭐ {vipLabel ?? "VIP"}
            </span>
          )}
        </div>

        {/* Subject + snippet + pills */}
        <div className="flex min-w-0 items-center gap-2">
          <p
            className={`min-w-0 truncate text-sm ${
              isUnread ? "text-slate-900" : workflowStatus === "done" ? "text-slate-400" : "text-slate-700"
            }`}
          >
            <span className={isUnread ? "font-semibold" : "font-normal"}>{subjectLine}</span>
            {snippet && subjectLine !== snippet && (
              <span className="text-slate-400"> — {snippet}</span>
            )}
          </p>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={`flex items-center gap-1 text-[10px] font-semibold ${statusText}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot}`} />
              {statusLabel}
            </span>
            {hasDraft && workflowStatus !== "done" && (
              <span className="text-[10px] font-semibold text-[#39597f]">✦ draft</span>
            )}
            <ContentTypeBadge emailType={contentType} />
            {snoozeUntil && (
              <span className="text-xs text-slate-500">
                💤 {new Date(snoozeUntil).toLocaleDateString()}
              </span>
            )}
          </span>
        </div>

        {/* Hover action strip — inline, right-aligned; not absolutely positioned since
            the row already has room at full page width */}
        <div
          className={`flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${
            showAttention ? "opacity-100" : ""
          }`}
        >
          <button
            type="button"
            onClick={toggleRead}
            disabled={!!pendingAction}
            title={isRead ? "Mark unread" : "Mark read"}
            aria-label={isRead ? "Mark unread" : "Mark read"}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] disabled:opacity-40 disabled:cursor-wait"
          >
            {pendingAction === "read"
              ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
              : isRead
                ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-400" />
                : <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" />}
          </button>

          <button
            ref={attentionBtnRef}
            type="button"
            onClick={openAttentionDropdown}
            disabled={!!pendingAction}
            title="Change label"
            aria-label="Change label"
            aria-expanded={showAttention}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] disabled:opacity-40 disabled:cursor-wait"
          >
            {pendingAction === "attention"
              ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
              : (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 1h4.5L11 6.5 6.5 11 1 5.5V1Z" />
                  <circle cx="3.5" cy="3.5" r="0.75" fill="currentColor" stroke="none" />
                </svg>
              )}
          </button>

          {onSnooze && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSnooze() }}
              disabled={!!pendingAction}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-wait"
              title="Snooze"
            >
              💤
            </button>
          )}

          {supportsMailboxActions && (
            <button
              type="button"
              onClick={archiveConversation}
              disabled={!!pendingAction}
              title={archiveError ?? "Archive"}
              aria-label="Archive"
              className={`flex h-6 w-6 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] disabled:opacity-40 disabled:cursor-wait ${
                archiveError
                  ? "text-red-500 hover:bg-red-50"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              {pendingAction === "archive"
                ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
                : (
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="1" y="1" width="10" height="3" rx="0.5" />
                    <path d="M2 4v6.5h8V4" />
                    <path d="M4.5 6.5L6 8l1.5-1.5M6 8V5.5" />
                  </svg>
                )}
            </button>
          )}

          {!isPersonal && (
            <button
              type="button"
              onClick={toggleStatus}
              disabled={!!pendingAction}
              title={isClosed ? "Reopen thread" : "Close thread"}
              aria-label={isClosed ? "Reopen thread" : "Close thread"}
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] disabled:opacity-40 disabled:cursor-wait"
            >
              {pendingAction === "status"
                ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
                : isClosed ? (
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10 6A4 4 0 1 1 6 2" />
                    <path d="M4.5 3.5L6 2L7.5 3.5" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 6.5 5 9.5 10 3" />
                  </svg>
                )}
            </button>
          )}
        </div>

        {/* Timestamp */}
        <span className={`shrink-0 text-right text-xs ${isUnread ? "font-medium text-slate-600" : "text-slate-400"}`}>
          {timeLabel}
        </span>
      </Link>

      {/* Attention dropdown — portal into document.body so it escapes any scroll container */}
      {showAttention && dropdownPos && typeof document !== "undefined" && createPortal(
        <div
          ref={portalRef}
          style={{ position: "fixed", top: dropdownPos.top, right: dropdownPos.right, zIndex: 9999 }}
          className="min-w-[126px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {FLOWDESK_LABEL_OPTIONS.map((opt) => {
            const disabled = opt.value === "Autodrafted" && !hasDraft
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={(e) => changeLabel(e, opt.value)}
                title={disabled ? "Only available when a draft is proposed or approved" : undefined}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-slate-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                  label === opt.value ? "font-semibold text-slate-900" : "text-slate-700"
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${opt.dot}`} />
                {opt.label}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}
