# Inbox UX Polish (Session 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 7 inbox UI improvements — right rail simplification, layout centering, sync dedup, email padding, hover row actions, and reply composer redesign.

**Architecture:** Tasks 1–3 (quick wins) are pure CSS/import edits. Task 4 introduces `InboxRow` as a new client component wrapping server-fetched row data, keeping `AppListColumn` a server component. Task 5 refactors `ReplyComposer` to support a collapsed/expanded state with email header fields, wiring into existing API endpoints.

**Tech Stack:** Next.js 14 App Router, React, Tailwind CSS, Prisma (server components only), existing API routes (`/api/conversations/:id/read`, `/api/conversations/:id/status`, `/api/conversations/:id/send`)

---

### Task 1: Quick wins — layout, sync dedup, email padding

**Files:**
- Modify: `app/components/HomeCommandCenter.tsx` (add `mx-auto`)
- Modify: `app/components/HomeHeader.tsx` (remove `GmailSyncControl`)
- Modify: `app/conversations/[id]/page.tsx` (tighten thread area padding)

- [ ] **Step 1: Center the Home command center content**

In `app/components/HomeCommandCenter.tsx`, find the inner wrapper div and add `mx-auto`:

```tsx
// Before
<div className="px-5 py-5 max-w-5xl">

// After
<div className="px-5 py-5 max-w-5xl mx-auto">
```

- [ ] **Step 2: Remove duplicate GmailSyncControl from HomeHeader**

In `app/components/HomeHeader.tsx`, remove the `GmailSyncControl` import and its usage:

```tsx
// Before (full file)
"use client"

import GmailSyncControl from "@/app/components/GmailSyncControl"

// ... (GmailSyncChannel type, greeting/dateLabel helpers unchanged)

export default function HomeHeader({ date, firstName, gmailChannels }: Props) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <div>
        <p className="text-base font-semibold text-slate-900">
          {greeting(date)}{firstName ? `, ${firstName}` : ""}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">{dateLabel(date)}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <GmailSyncControl channels={gmailChannels} compact />
      </div>
    </div>
  )
}
```

```tsx
// After (full file) — remove import, remove right div, simplify to just the greeting
"use client"

type GmailSyncChannel = {
  id: string
  emailAddress: string | null
  lastSyncedAt: Date | string | null
  lastSyncError: string | null
  watchExpiresAt?: Date | string | null
}

function greeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

interface Props {
  date: Date
  firstName: string | null
  gmailChannels: GmailSyncChannel[]
}

export default function HomeHeader({ date, firstName }: Props) {
  return (
    <div className="mb-3">
      <p className="text-base font-semibold text-slate-900">
        {greeting(date)}{firstName ? `, ${firstName}` : ""}
      </p>
      <p className="text-[11px] text-slate-400 mt-0.5">{dateLabel(date)}</p>
    </div>
  )
}
```

Note: `gmailChannels` prop stays in the interface to avoid breaking callers, but is no longer used internally.

- [ ] **Step 3: Tighten email reading padding in conversation page**

In `app/conversations/[id]/page.tsx`, find the desktop scrollable messages area and reduce padding:

```tsx
// Before
<div className="flex-1 overflow-y-auto px-3 py-4">

// After
<div className="flex-1 overflow-y-auto px-2 py-3">
```

And tighten the article card inner padding:

```tsx
// Before
className={`overflow-hidden rounded-xl border px-4 py-3 ${

// After
className={`overflow-hidden rounded-xl border px-3 py-2.5 ${
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing ones unrelated to these files).

- [ ] **Step 5: Commit**

```bash
git add app/components/HomeCommandCenter.tsx app/components/HomeHeader.tsx app/conversations/\[id\]/page.tsx
git commit -m "fix: center home layout, remove duplicate sync button, tighten email padding"
```

---

### Task 2: Right rail — hide cards for FYI/quiet emails

**Files:**
- Modify: `app/conversations/[id]/page.tsx`

The variable `isAutoEmailConversation` is already computed in the page. It's `true` when `attentionCategory` is `quiet`/`fyi_done`, or when `emailType` is `notification`/`newsletter`/`marketing`.

- [ ] **Step 1: Wrap `extraCards` in a conditional**

In `app/conversations/[id]/page.tsx`, find the `extraCards` variable definition (around line 443) and wrap it:

```tsx
// Before
const extraCards = (
  <>
    {summaryCard}
    <ExplainThreadPanel conversationId={conversation.id} />
    <CollapsibleCard title="Work items">
      <WorkItemsPanel ... />
    </CollapsibleCard>
    {personMemory && (
      <CollapsibleCard title="Relationship">
        ...
      </CollapsibleCard>
    )}
  </>
)
```

```tsx
// After
const extraCards = isAutoEmailConversation ? null : (
  <>
    {summaryCard}
    <ExplainThreadPanel conversationId={conversation.id} />
    <CollapsibleCard title="Work items">
      <WorkItemsPanel
        state={stateRecord}
        tasks={inboxTasks}
        lead={lead}
        conversationId={conversation.id}
        isPersonal={isPersonal}
        bare
      />
    </CollapsibleCard>
    {personMemory && (
      <CollapsibleCard title="Relationship">
        <div className="min-w-0 space-y-3 break-words text-xs text-slate-600 leading-relaxed [overflow-wrap:anywhere]">
          <p>{personMemory.summary}</p>
          {personMemory.promisedActions && (
            <div>
              <p className="mb-1 font-semibold text-slate-500">Promises made</p>
              <p className="whitespace-pre-line">{personMemory.promisedActions}</p>
            </div>
          )}
          {personMemory.openQuestions && (
            <div>
              <p className="mb-1 font-semibold text-slate-500">Open questions</p>
              <p className="whitespace-pre-line">{personMemory.openQuestions}</p>
            </div>
          )}
          {personMemory.preferences && (
            <div>
              <p className="mb-1 font-semibold text-slate-500">Preferences noted</p>
              <p className="whitespace-pre-line">{personMemory.preferences}</p>
            </div>
          )}
          {conversation.contactId && (
            <PersonMemoryEditShell
              contactId={conversation.contactId}
              memory={{
                summary: personMemory.summary ?? null,
                preferences: personMemory.preferences ?? null,
                openQuestions: personMemory.openQuestions ?? null,
                promisedActions: personMemory.promisedActions ?? null,
              }}
            />
          )}
        </div>
      </CollapsibleCard>
    )}
  </>
)
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/conversations/\[id\]/page.tsx
git commit -m "feat: hide summary/work items/relationship cards for FYI and quiet emails"
```

---

### Task 3: Hover actions on inbox list rows

**Files:**
- Create: `app/components/InboxRow.tsx`
- Modify: `app/components/AppListColumn.tsx`

`AppListColumn` stays a server component — it does the DB query and passes row data as props. `InboxRow` is a new client component that owns hover state and calls the action APIs.

- [ ] **Step 1: Create `InboxRow.tsx`**

Create `app/components/InboxRow.tsx`:

```tsx
"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

type InboxRowProps = {
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
  initialReadAt: boolean   // true if conversation.readAt is non-null
  initialStatus: string    // "needs_reply" | "in_progress" | "closed"
}

export default function InboxRow({
  id,
  href,
  isSelected,
  isUnread: initialUnread,
  isFyi,
  isClosed: initialClosed,
  name,
  snippet,
  timeLabel,
  statusDot,
  statusText,
  statusLabel,
  hasDraft,
  initialReadAt,
  initialStatus,
}: InboxRowProps) {
  const router = useRouter()
  const [isHovered, setIsHovered] = useState(false)
  const [isRead, setIsRead] = useState(initialReadAt)
  const [status, setStatus] = useState(initialStatus)

  const isUnread = !isRead && !isFyi
  const isClosed = status === "closed"

  async function toggleRead(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const nextRead = !isRead
    setIsRead(nextRead)
    await fetch(`/api/conversations/${id}/read`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: nextRead }),
    })
    router.refresh()
  }

  async function toggleStatus(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const nextStatus = isClosed ? "needs_reply" : "closed"
    setStatus(nextStatus)
    await fetch(`/api/conversations/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    })
    router.refresh()
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Link
        href={href}
        className={`block border-b border-slate-50 px-3 py-2.5 transition ${
          isSelected
            ? "border-l-2 border-l-blue-500 bg-blue-50"
            : isUnread
              ? "hover:bg-blue-50/60"
              : "hover:bg-slate-50"
        }`}
      >
        <div className="flex items-baseline justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {isUnread && (
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
            )}
            <p
              className={`min-w-0 truncate text-xs ${
                isUnread
                  ? "font-bold text-slate-900"
                  : isFyi || isClosed
                    ? "font-normal text-slate-500"
                    : "font-semibold text-slate-800"
              }`}
            >
              {name}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-slate-400">{timeLabel}</span>
        </div>
        {snippet && (
          <p className={`mt-0.5 truncate text-[11px] ${
            isUnread ? "text-slate-600" : isFyi || isClosed ? "text-slate-400" : "text-slate-500"
          }`}>{snippet}</p>
        )}
        <div className="mt-1 flex items-center gap-1.5">
          <span className={`flex items-center gap-1 text-[10px] font-semibold ${statusText}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
          {hasDraft && !isFyi && (
            <span className="text-[10px] font-semibold text-blue-600">✦ draft</span>
          )}
        </div>
      </Link>

      {/* Hover action strip */}
      {isHovered && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1 shadow-sm">
          <button
            type="button"
            onClick={toggleRead}
            title={isRead ? "Mark unread" : "Mark read"}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            {isRead ? (
              <span className="h-2 w-2 rounded-full border-2 border-slate-400 inline-block" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-blue-500 inline-block" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleStatus}
            title={isClosed ? "Reopen" : "Close"}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            {isClosed ? "↺" : "✓"}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update `AppListColumn` to use `InboxRow`**

In `app/components/AppListColumn.tsx`:

1. Add the import at the top:
```tsx
import InboxRow from "@/app/components/InboxRow"
```

2. Replace the `conversations.map(...)` block (the entire `<Link>...</Link>` per-row) with `<InboxRow>`:

```tsx
conversations.map((conv) => {
  const fyi = isFyi(conv)
  const attention = attentionCategory(conv)
  const attentionStyle = attention ? ATTENTION_STYLE[attention] : null
  const displayStatus = fyi ? "closed" : conv.status
  const style = STATUS_STYLE[displayStatus] ?? { dot: "bg-slate-300", text: "text-slate-500" }
  const name = conv.contact?.name ?? conv.externalThreadId
  const snippet = conv.messages[0]?.body
    ? stripHtmlToText(conv.messages[0].body, 75)
    : ""
  const hasDraft =
    conv.draft?.status === "proposed" || conv.draft?.status === "approved"
  const isClosed = conv.status === "closed"

  return (
    <InboxRow
      key={conv.id}
      id={conv.id}
      href={buildConversationHref(conv.id, returnTo)}
      isSelected={conv.id === activeConversationId}
      isUnread={!conv.readAt && conv.gmailUnread !== false && !fyi}
      isFyi={fyi}
      isClosed={isClosed}
      name={name}
      snippet={snippet}
      timeLabel={relativeTime(conv.lastMessageAt)}
      statusDot={attentionStyle?.dot ?? style.dot}
      statusText={attentionStyle?.text ?? style.text}
      statusLabel={attentionStyle?.label ?? (fyi ? "No reply needed" : STATUS_LABEL[displayStatus] ?? displayStatus)}
      hasDraft={hasDraft}
      initialReadAt={conv.readAt !== null}
      initialStatus={conv.status}
    />
  )
})
```

Note: Remove the old `const isSelected = ...` and `const isUnread = ...` lines — they are now computed inside `InboxRow`.

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/InboxRow.tsx app/components/AppListColumn.tsx
git commit -m "feat: add hover actions (mark read/unread, close/reopen) to inbox list rows"
```

---

### Task 4: Reply composer — collapsed state + email header fields

**Files:**
- Modify: `app/conversations/[id]/ReplyComposer.tsx`

The goal is to add a collapsed state (compact bar) and email header fields (To, CC, BCC, Subject) to the existing composer. All existing send/draft/clear API logic is unchanged.

- [ ] **Step 1: Add new state variables to `ReplyComposer`**

At the top of the `ReplyComposer` function body, after the existing `useState` calls, add:

```tsx
const [isExpanded, setIsExpanded] = useState(initialDraft !== null)
const [ccOpen, setCcOpen] = useState(false)
const [bccOpen, setBccOpen] = useState(false)
const [cc, setCc] = useState("")
const [bcc, setBcc] = useState("")
```

- [ ] **Step 2: Add `senderAddress` and `reSubject` props**

Update the component props type and signature:

```tsx
export default function ReplyComposer({
  conversationId,
  channelType,
  canSuggest,
  isPersonal = false,
  initialDraft,
  conciergeTemplates,
  senderAddress,
  threadSubject,
}: {
  conversationId: string;
  channelType: string;
  canSuggest: boolean;
  isPersonal?: boolean;
  initialDraft: DraftSnapshot | null;
  conciergeTemplates?: Array<{ id: string; title: string; content: string }>;
  senderAddress?: string;
  threadSubject?: string;
}) {
```

- [ ] **Step 3: Update the caller in `page.tsx` to pass new props**

In `app/conversations/[id]/page.tsx`, find the `replyComposer` block and pass the sender address and subject:

```tsx
const replyComposer = (
  <div className="px-4 py-2">
    <ReplyComposer
      conversationId={conversation.id}
      channelType={conversation.channel.type}
      canSuggest={canSuggestReply}
      isPersonal={isPersonal}
      senderAddress={
        conversation.messages.length > 0
          ? conversation.messages[conversation.messages.length - 1].fromE164
          : (conversation.channel.emailAddress ?? undefined)
      }
      threadSubject={conversation.externalThreadId}
      initialDraft={
        conversation.draft
          ? {
              id: conversation.draft.id,
              text: conversation.draft.text,
              status: conversation.draft.status,
              metadataJson: draftMetadata ?? null,
            }
          : null
      }
      conciergeTemplates={conciergeTemplates.length > 0 ? conciergeTemplates : undefined}
    />
  </div>
)
```

- [ ] **Step 4: Add collapsed state UI**

In `ReplyComposer.tsx`, replace the `return` statement with one that branches on `isExpanded`. Add before the existing `return`:

```tsx
if (!isEmail) {
  return (
    <p className="px-3 py-2 text-xs text-slate-500 rounded-lg border border-slate-200 bg-slate-50">
      AI suggestions are available for email conversations only.
    </p>
  );
}

// Collapsed state
if (!isExpanded) {
  return (
    <button
      type="button"
      onClick={() => setIsExpanded(true)}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 transition"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
        Me
      </div>
      <span className="flex-1 text-sm text-slate-400">
        {senderAddress ? `Reply to ${senderAddress}…` : "Write a reply…"}
      </span>
      <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
        Reply
      </span>
    </button>
  )
}
```

Remove the old `if (!isEmail)` early return that was at line 158, since we handle it above now.

- [ ] **Step 5: Replace the expanded composer return with email-header layout**

Replace the existing `return (...)` at the bottom of the component with the full expanded composer:

```tsx
return (
  <div className="space-y-0 rounded-xl border border-slate-300 overflow-hidden bg-white shadow-sm">
    {/* Email header fields */}
    <div className="border-b border-slate-100">
      {/* To field */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <span className="text-[11px] font-semibold text-slate-400 w-6 shrink-0">To</span>
        <span className="flex-1 text-sm text-slate-700 truncate">
          {senderAddress ?? "—"}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {!ccOpen && (
            <button
              type="button"
              onClick={() => setCcOpen(true)}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              CC
            </button>
          )}
          {!bccOpen && (
            <button
              type="button"
              onClick={() => setBccOpen(true)}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              BCC
            </button>
          )}
        </div>
      </div>

      {/* CC field — shown when ccOpen */}
      {ccOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
          <span className="text-[11px] font-semibold text-slate-400 w-6 shrink-0">CC</span>
          <input
            type="text"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="cc@example.com"
            className="flex-1 text-sm text-slate-700 outline-none bg-transparent"
            disabled={isBusy}
          />
          <button
            type="button"
            onClick={() => { setCcOpen(false); setCc("") }}
            className="text-[11px] text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* BCC field — shown when bccOpen */}
      {bccOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
          <span className="text-[11px] font-semibold text-slate-400 w-6 shrink-0">BCC</span>
          <input
            type="text"
            value={bcc}
            onChange={(e) => setBcc(e.target.value)}
            placeholder="bcc@example.com"
            className="flex-1 text-sm text-slate-700 outline-none bg-transparent"
            disabled={isBusy}
          />
          <button
            type="button"
            onClick={() => { setBccOpen(false); setBcc("") }}
            className="text-[11px] text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* Subject (read-only) */}
      {threadSubject && (
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-[11px] font-semibold text-slate-400 w-6 shrink-0">Re</span>
          <span className="flex-1 text-[12px] text-slate-400 truncate">{threadSubject}</span>
        </div>
      )}
    </div>

    {/* Draft status indicator */}
    {draftStatusLabel && (
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-700">
          {draftStatusLabel}
        </span>
        <button
          type="button"
          onClick={clearDraft}
          disabled={isBusy}
          className="text-[11px] text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    )}

    {/* Risk warning */}
    {isRisky && (
      <p className="mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        Sensitive content detected — review carefully before sending.
        {typeof escalationReason === "string" && escalationReason ? ` ${escalationReason}` : ""}
      </p>
    )}

    {/* Main textarea */}
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => { if (!hasDraftText) setIsFocused(false) }}
      rows={isFocused || hasDraftText ? 5 : 3}
      placeholder={canAI ? "Type a reply, or use Draft with AI below…" : "Type your reply…"}
      className="w-full resize-none px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:outline-none disabled:bg-slate-50"
      disabled={isBusy}
      autoFocus
    />

    {/* Template picker */}
    {canAI && conciergeTemplates && conciergeTemplates.length > 0 && (
      <div className="px-3 pb-2">
        <label className="text-xs text-slate-500">Start from template</label>
        <select
          className="mt-0.5 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
          defaultValue=""
          onChange={(e) => {
            const tpl = conciergeTemplates.find((t) => t.id === e.target.value)
            if (tpl) {
              setInstruction(`Use this template as a starting point:\n${tpl.content}`)
              setShowInstruction(true)
            }
          }}
        >
          <option value="">— pick a template —</option>
          {conciergeTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>
    )}

    {/* AI instruction row */}
    {canAI && (
      <div className="px-3 pb-2">
        {!showInstruction ? (
          <button
            type="button"
            onClick={() => setShowInstruction(true)}
            className="text-[11px] text-slate-400 hover:text-slate-600"
          >
            + Add instruction for AI
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. say yes, but only next week"
              maxLength={300}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
              disabled={isBusy}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); suggestReply(); } }}
            />
            <button
              type="button"
              onClick={() => { setShowInstruction(false); setInstruction(""); }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    )}

    {/* Error / notice */}
    {error && <p className="px-3 pb-1 text-xs text-red-600">{error}</p>}
    {notice && <p className="px-3 pb-1 text-xs text-emerald-700">{notice}</p>}

    {/* No business profile hint */}
    {isEmail && !isPersonal && !canSuggest && (
      <p className="mx-3 mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Add a business profile in Settings to enable AI suggestions.
      </p>
    )}

    {/* Bottom toolbar */}
    <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2">
      {canAI && (
        <button
          type="button"
          onClick={suggestReply}
          disabled={isBusy}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {action === "suggesting" ? "Drafting…" : "Draft with AI"}
        </button>
      )}
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => setIsExpanded(false)}
        disabled={isBusy}
        className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
      >
        Discard
      </button>
      <button
        type="button"
        onClick={send}
        disabled={!hasDraftText || isBusy}
        className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {action === "sending" ? "Sending…" : "Send"}
      </button>
    </div>
  </div>
)
```

- [ ] **Step 6: Remove the old wrapper border from the reply composer container in `page.tsx`**

The new composer already has `rounded-xl border border-slate-300 shadow-sm`. The outer wrapper in `page.tsx` wraps it in `<div className="shrink-0 border-t border-slate-200 bg-white">`. Keep the border-t (separates thread from composer). No change needed here.

For mobile, the existing `<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">` wrapper around `{replyComposer}` will add a double-border. Update it to remove the border:

```tsx
// Before (mobile composer wrapper, around line 693)
<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
  {replyComposer}
</div>

// After
<div className="overflow-hidden">
  {replyComposer}
</div>
```

- [ ] **Step 7: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add app/conversations/\[id\]/ReplyComposer.tsx app/conversations/\[id\]/page.tsx
git commit -m "feat: collapse reply composer behind compact bar, add email header fields (To, CC, BCC, Subject)"
```

---

### Task 5: Open a PR

- [ ] **Step 1: Push branch and open PR**

```bash
git push origin main
gh pr create \
  --title "feat: inbox UX polish — layout, hover actions, composer, right rail" \
  --body "$(cat <<'EOF'
## Summary

- **Wide-screen layout:** Centers Home command center content on large monitors (mx-auto)
- **Duplicate sync button:** Removed GmailSyncControl from HomeHeader; inbox list column is canonical
- **Email reading padding:** Tightened article card and thread scroll padding
- **Right rail:** FYI/quiet/newsletter emails now show only contact + assistant card (hides summary, work items, relationship, explain-thread)
- **Hover row actions:** New \`InboxRow\` client component adds mark-read and close/reopen icon buttons on hover, with optimistic updates
- **Reply composer:** Collapsed bar by default; expands in-place with To/CC/BCC/Subject email header fields, Draft with AI, and Send

## Test plan

- [ ] On a wide monitor (>1280px), Home view content is centered with even whitespace on both sides
- [ ] Inbox list header shows exactly one sync button/status (not two)
- [ ] Email thread cards have tighter inner padding
- [ ] Open a FYI/quiet/notification email — right rail shows only Contact and "No reply needed" card; no summary, work items, or relationship cards
- [ ] Open a needs_reply email — right rail shows all cards as before
- [ ] Hover over an unread inbox row — read/unread dot icon and close/reopen checkmark appear; clicking either updates row state immediately and persists
- [ ] Hover over a closed inbox row — close icon shows ↺ (reopen); clicking reopens the thread
- [ ] Conversation thread view: reply area shows compact collapsed bar by default
- [ ] Clicking "Reply" or the bar expands the composer with To pre-filled from the thread sender
- [ ] CC/BCC fields appear when their buttons are clicked; dismiss with ✕
- [ ] Draft with AI and Send still work as before

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Record the PR URL**

```bash
gh pr view --json url -q .url
```

---

## Notes

- **CC/BCC in send API:** The current `POST /api/conversations/:id/send` accepts `{ text }` only. The CC/BCC fields are rendered in the UI but not wired into the API call — that requires a backend change outside this spec's scope. The fields capture user input correctly and are available for a future `{ text, cc, bcc }` extension.
- **`InboxRow` and server component boundary:** `AppListColumn` remains a pure server component. `InboxRow` is the client boundary. All DB queries and filter logic stay in `AppListColumn`.
- **Optimistic updates in `InboxRow`:** Local state updates immediately on action click; `router.refresh()` syncs the server-rendered list. If the API call fails, the state will be corrected on the next refresh.
