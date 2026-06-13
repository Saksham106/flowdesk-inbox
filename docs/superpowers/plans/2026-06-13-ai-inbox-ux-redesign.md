# AI Inbox UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform FlowDesk from a narrow top-nav email list into an AI-first desktop app — left icon rail, persistent email list column, command-center home view, and a seamless conversation thread+composer flow.

**Architecture:** Left icon rail (56 px, dark) + scrollable email list column (280 px) + main pane (remainder). Both `/inbox` and `/conversations/[id]` render inside the same visual shell. Routes and all existing data-fetching stay the same; we add layout wrappers and replace the presentation layer. Mobile (< lg) keeps the existing full-page pattern with no changes to mobile routing or navigation.

**Tech Stack:** Next.js 15 App Router, React 19 server + client components, Tailwind CSS v4, Prisma, Vitest.

---

## File Map

| Action | Path | Role |
|--------|------|------|
| **Create** | `app/components/AppRail.tsx` | Client component — icon rail with active state |
| **Create** | `app/components/AppListColumn.tsx` | Server component — email list column |
| **Create** | `app/components/HomeCommandCenter.tsx` | Server component — replaces CommandCenterPanel |
| **Modify** | `lib/email-body.ts` | Add `stripHtmlToText` helper |
| **Modify** | `email-body.test.ts` | Add tests for `stripHtmlToText` |
| **Modify** | `app/inbox/page.tsx` | Add desktop shell + HomeCommandCenter |
| **Modify** | `app/digest/page.tsx` | Replace with `/inbox` redirect |
| **Modify** | `app/conversations/[id]/page.tsx` | Add desktop shell + new thread layout |
| **Modify** | `app/conversations/[id]/HandleThisPanel.tsx` | "Why this matters" rename, personal language |
| **Modify** | `app/conversations/[id]/AIDraftPanel.tsx` | Personal language fix |
| **Modify** | `app/conversations/[id]/WorkItemsPanel.tsx` | Personal language fix |
| **Delete** | `app/inbox/CommandCenterPanel.tsx` | Superseded by HomeCommandCenter |

---

## Task 1: Add `stripHtmlToText` to `lib/email-body.ts`

**Files:**
- Modify: `lib/email-body.ts`
- Test: `email-body.test.ts`

- [ ] **Step 1: Add the function to `lib/email-body.ts`**

Append after `renderEmailBodyHtml`:

```typescript
export function stripHtmlToText(body: string, maxLength = 80): string {
  let text: string
  if (isHtmlBody(body)) {
    text = body
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim()
  } else {
    text = body
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/\n/g, " ")
      .trim()
  }
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text
}
```

- [ ] **Step 2: Write the tests (add at end of `email-body.test.ts`)**

```typescript
import { stripHtmlToText } from "@/lib/email-body";

describe("stripHtmlToText", () => {
  it("strips HTML tags from an HTML body", () => {
    const result = stripHtmlToText("<p>Hello <b>world</b></p>")
    expect(result).toBe("Hello world")
  })

  it("strips style and script blocks entirely", () => {
    const result = stripHtmlToText(
      '<style>.foo{color:red}</style><p>Content</p><script>alert(1)</script>'
    )
    expect(result).not.toContain(".foo")
    expect(result).not.toContain("alert")
    expect(result).toBe("Content")
  })

  it("decodes common HTML entities", () => {
    const result = stripHtmlToText("<p>cats &amp; dogs &lt;3&gt;</p>")
    expect(result).toBe("cats & dogs <3>")
  })

  it("truncates at maxLength and appends ellipsis", () => {
    const result = stripHtmlToText("<p>" + "a".repeat(100) + "</p>", 20)
    expect(result).toHaveLength(21) // 20 chars + ellipsis char
    expect(result.endsWith("…")).toBe(true)
  })

  it("does not truncate short HTML bodies", () => {
    const result = stripHtmlToText("<p>Short</p>", 80)
    expect(result).toBe("Short")
  })

  it("strips markdown syntax from plain text", () => {
    const result = stripHtmlToText("**Bold** and _italic_ text")
    expect(result).toBe("Bold and italic text")
  })

  it("collapses newlines in plain text", () => {
    const result = stripHtmlToText("Line 1\nLine 2\nLine 3")
    expect(result).toBe("Line 1 Line 2 Line 3")
  })

  it("returns empty string for blank input", () => {
    expect(stripHtmlToText("")).toBe("")
    expect(stripHtmlToText("   ")).toBe("")
  })
})
```

- [ ] **Step 3: Run the new tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox
npx vitest run email-body.test.ts
```

Expected: all tests pass (including existing ones).

- [ ] **Step 4: Commit**

```bash
git add lib/email-body.ts email-body.test.ts
git commit -m "feat: add stripHtmlToText helper for clean email list snippets"
```

---

## Task 2: Create `AppRail` (client component)

**Files:**
- Create: `app/components/AppRail.tsx`

- [ ] **Step 1: Create the file**

```tsx
// app/components/AppRail.tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

interface Props {
  needsReplyCount: number
  accountType: string | null
}

const BUSINESS_OVERFLOW = [
  { label: "Leads", href: "/leads" },
  { label: "Approvals", href: "/approvals" },
  { label: "Risk Radar", href: "/risk-radar" },
  { label: "Reports", href: "/reports" },
  { label: "Meetings", href: "/meetings" },
  { label: "Knowledge Base", href: "/knowledge-base" },
  { label: "Audit", href: "/audit" },
]

export default function AppRail({ needsReplyCount, accountType }: Props) {
  const pathname = usePathname()
  const [overflowOpen, setOverflowOpen] = useState(false)

  const isEmailSection =
    pathname === "/inbox" || pathname.startsWith("/conversations/")
  const isTasks = pathname === "/tasks"
  const isSettings = pathname === "/settings"
  const isBusiness = accountType === "business"

  return (
    <nav className="flex h-full w-14 shrink-0 flex-col items-center bg-slate-900 py-3 gap-1">
      {/* Logo */}
      <div className="mb-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-sm font-black text-white select-none">
        F
      </div>

      {/* Home / email section */}
      <RailLink
        href="/inbox"
        active={isEmailSection}
        badge={needsReplyCount > 0 ? needsReplyCount : undefined}
        label="Home"
      >
        <HomeIcon />
      </RailLink>

      {/* Tasks */}
      <RailLink href="/tasks" active={isTasks} label="Tasks">
        <TasksIcon />
      </RailLink>

      <div className="flex-1" />

      {/* Business overflow */}
      {isBusiness && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOverflowOpen((v) => !v)}
            className={`flex h-9 w-10 flex-col items-center justify-center gap-0.5 rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 ${overflowOpen ? "bg-slate-800 text-slate-200" : ""}`}
            aria-label="More"
          >
            <span className="block h-1 w-1 rounded-full bg-current" />
            <span className="block h-1 w-1 rounded-full bg-current" />
            <span className="block h-1 w-1 rounded-full bg-current" />
          </button>
          {overflowOpen && (
            <div className="absolute bottom-full left-full z-50 mb-1 ml-1 min-w-40 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl">
              {BUSINESS_OVERFLOW.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOverflowOpen(false)}
                  className="block px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Settings */}
      <RailLink href="/settings" active={isSettings} label="Settings">
        <SettingsIcon />
      </RailLink>
    </nav>
  )
}

function RailLink({
  href,
  active,
  badge,
  label,
  children,
}: {
  href: string
  active: boolean
  badge?: number
  label: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={label}
      className={`relative flex h-9 w-10 flex-col items-center justify-center gap-0.5 rounded-lg transition ${
        active
          ? "bg-slate-700 text-white"
          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      }`}
    >
      {children}
      <span className="text-[8px] font-semibold leading-none">{label}</span>
      {badge !== undefined && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  )
}

function HomeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline strokeLinecap="round" strokeLinejoin="round" points="9,22 9,12 15,12 15,22" />
    </svg>
  )
}

function TasksIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <polyline strokeLinecap="round" strokeLinejoin="round" points="9 11 12 14 22 4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox
npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

Expected: no errors for this file.

- [ ] **Step 3: Commit**

```bash
git add app/components/AppRail.tsx
git commit -m "feat: add AppRail icon navigation component"
```

---

## Task 3: Create `AppListColumn` (server component)

**Files:**
- Create: `app/components/AppListColumn.tsx`

This component fetches its own conversation list (50 items) and renders the left email list column. It is a server component, so it can do DB queries directly.

- [ ] **Step 1: Create the file**

```tsx
// app/components/AppListColumn.tsx
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { stripHtmlToText } from "@/lib/email-body"
import SearchInput from "@/app/inbox/SearchInput"
import { Suspense } from "react"

interface Props {
  tenantId: string
  accountType: string | null
  activeConversationId?: string
  /** status filter in the URL — used to highlight filter pills and filter results */
  status?: string | null
  /** search query from URL */
  q?: string
}

type ConvRow = {
  id: string
  status: string
  lastMessageAt: Date
  externalThreadId: string
  contact: { name: string } | null
  messages: { body: string }[]
  draft: { status: string } | null
  stateRecord: { state: string; metadataJson: unknown } | null
}

function isFyi(conv: ConvRow): boolean {
  if (conv.stateRecord?.state === "fyi_only") return true
  const meta = conv.stateRecord?.metadataJson
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const t = (meta as Record<string, unknown>).emailType
    if (t === "notification" || t === "newsletter" || t === "marketing") return true
  }
  return false
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(diff / 86400000)
  return `${days}d`
}

const STATUS_FILTERS = [
  { label: "All", value: null },
  { label: "Reply", value: "needs_reply" },
  { label: "Progress", value: "in_progress" },
  { label: "Closed", value: "closed" },
]

const STATUS_STYLE: Record<string, { dot: string; label: string; text: string }> = {
  needs_reply: { dot: "bg-red-500", label: "Needs Reply", text: "text-red-700" },
  in_progress: { dot: "bg-amber-400", label: "In Progress", text: "text-amber-700" },
  closed: { dot: "bg-emerald-500", label: "Closed", text: "text-emerald-700" },
}

export default async function AppListColumn({
  tenantId,
  accountType,
  activeConversationId,
  status,
  q,
}: Props) {
  const isBusiness = accountType === "business"
  const where: Record<string, unknown> = { tenantId }
  if (status) where.status = status
  if (q) {
    where.OR = [
      { externalThreadId: { contains: q, mode: "insensitive" } },
      { contact: { name: { contains: q, mode: "insensitive" } } },
    ]
  }

  const [conversations, counts] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 50,
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        contact: true,
        draft: { select: { status: true } },
        stateRecord: { select: { state: true, metadataJson: true } },
      },
    }) as Promise<ConvRow[]>,
    prisma.conversation.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { status: true },
    }),
  ])

  const countMap = Object.fromEntries(counts.map((r) => [r.status, r._count.status]))

  function filterPillHref(s: string | null): string {
    const p = new URLSearchParams()
    if (s) p.set("status", s)
    if (q) p.set("q", q)
    const qs = p.toString()
    return qs ? `/inbox?${qs}` : "/inbox"
  }

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* Header */}
      <div className="border-b border-slate-100 px-3 pb-2 pt-3">
        <p className="mb-2 text-sm font-semibold text-slate-900">Inbox</p>
        <Suspense>
          <SearchInput defaultValue={q} />
        </Suspense>
        {/* Filter pills */}
        <div className="mt-2 flex flex-wrap gap-1">
          {STATUS_FILTERS.map(({ label, value }) => {
            const isActive = status === value || (value === null && !status)
            const count = value ? (countMap[value] ?? 0) : undefined
            return (
              <Link
                key={label}
                href={filterPillHref(value)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {label}
                {count !== undefined && count > 0 && (
                  <span className="ml-1 opacity-70">{count}</span>
                )}
              </Link>
            )
          })}
          {isBusiness && (
            <Link
              href="/inbox?sales=1"
              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
            >
              Sales
            </Link>
          )}
        </div>
      </div>

      {/* Conversation rows */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-4 py-8 text-xs text-slate-400">
            {q || status ? "No results." : "No conversations yet."}
          </p>
        ) : (
          conversations.map((conv) => {
            const fyi = isFyi(conv)
            const displayStatus = fyi ? "closed" : conv.status
            const style = STATUS_STYLE[displayStatus]
            const name = conv.contact?.name ?? conv.externalThreadId
            const snippet = conv.messages[0]?.body
              ? stripHtmlToText(conv.messages[0].body, 75)
              : ""
            const hasDraft =
              conv.draft?.status === "proposed" || conv.draft?.status === "approved"
            const isSelected = conv.id === activeConversationId

            return (
              <Link
                key={conv.id}
                href={`/conversations/${conv.id}`}
                className={`block border-b border-slate-50 px-3 py-2.5 transition ${
                  isSelected
                    ? "border-l-2 border-l-blue-500 bg-blue-50"
                    : "hover:bg-slate-50"
                } ${fyi ? "opacity-50" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <p
                    className={`min-w-0 truncate text-xs ${
                      conv.status === "needs_reply" && !fyi
                        ? "font-bold text-slate-900"
                        : "font-medium text-slate-700"
                    }`}
                  >
                    {name}
                  </p>
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {relativeTime(conv.lastMessageAt)}
                  </span>
                </div>
                {snippet && (
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">{snippet}</p>
                )}
                <div className="mt-1 flex items-center gap-1.5">
                  {style && (
                    <span className={`flex items-center gap-1 text-[10px] font-semibold ${style.text}`}>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
                      {fyi ? "No reply needed" : style.label}
                    </span>
                  )}
                  {hasDraft && !fyi && (
                    <span className="text-[10px] font-semibold text-blue-600">✦ draft</span>
                  )}
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in AppListColumn.

- [ ] **Step 3: Commit**

```bash
git add app/components/AppListColumn.tsx
git commit -m "feat: add AppListColumn server component with clean snippets"
```

---

## Task 4: Create `HomeCommandCenter` component

**Files:**
- Create: `app/components/HomeCommandCenter.tsx`

This replaces `CommandCenterPanel` with a full command-center view that fills the desktop main pane.

- [ ] **Step 1: Create the file**

```tsx
// app/components/HomeCommandCenter.tsx
import Link from "next/link"
import type { DailyCommandCenter, CommandCenterConversation } from "@/lib/agent/command-center"
import type { RevenueAtRiskItem } from "@/lib/agent/revenue-at-risk"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / 86400000)
  return `${days}d ago`
}

function ctaLabel(item: CommandCenterConversation): string {
  if (item.approvalReason) return "Review draft →"
  if (item.state === "risky_urgent") return "Urgent →"
  if (item.needsReply) return "Reply →"
  if (item.opportunity) return "Respond →"
  return "Open →"
}

interface FollowUp {
  id: string
  displayName: string
  scheduledAt: Date
  href: string
}

interface IgnoredItem {
  id: string
  displayName: string
  reason: string | null
  href: string
}

interface Props {
  commandCenter: DailyCommandCenter
  revenueAtRisk: RevenueAtRiskItem[]
  followUps: FollowUp[]
  ignoredItems: IgnoredItem[]
  accountType: string | null
  date: Date
}

export default function HomeCommandCenter({
  commandCenter,
  revenueAtRisk,
  followUps,
  ignoredItems,
  accountType,
  date,
}: Props) {
  const isBusiness = accountType === "business"
  const { counts, topActions, headline } = commandCenter

  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  // Stat chips shown in the header
  const headerStats = [
    { label: "Reply", value: counts.needsReply },
    { label: "Review", value: counts.approvals },
    { label: "Waiting", value: counts.waitingOnThem },
    { label: "Quiet", value: counts.safelyIgnored },
    ...(isBusiness ? [{ label: "Sales", value: counts.salesQualified }] : []),
  ]

  return (
    <div className="max-w-2xl px-6 py-6">
      {/* Dark gradient header */}
      <div className="mb-5 overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 px-5 py-5 text-white shadow-md">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
          {dateLabel}
        </p>
        <h1 className="mb-4 text-xl font-bold leading-snug">{headline}</h1>
        <div className="flex flex-wrap gap-2">
          {headerStats.map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg bg-white/10 px-3 py-2 text-center min-w-[56px]"
            >
              <p className="text-lg font-extrabold leading-none">{value}</p>
              <p className="mt-0.5 text-[10px] font-medium text-slate-300">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Business: Revenue at Risk */}
      {isBusiness && revenueAtRisk.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-600">
            Revenue at Risk
          </p>
          <div className="space-y-2">
            {revenueAtRisk.map((item) => (
              <Link
                key={item.conversationId}
                href={`/conversations/${item.conversationId}`}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 transition hover:bg-amber-100"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.contactName}</p>
                  <p className="text-xs text-amber-700">
                    No reply in {item.daysSinceLastMessage} day{item.daysSinceLastMessage === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="text-sm font-bold text-emerald-700">
                  ${item.estimatedValue.toLocaleString()}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Handle first */}
      {topActions.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            Handle first
          </p>
          <div className="space-y-2">
            {topActions.slice(0, 5).map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={`block rounded-xl border px-4 py-3 transition ${
                  item.priority === "urgent" || item.priority === "high"
                    ? "border-amber-200 bg-amber-50 hover:bg-amber-100"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">{item.displayName}</p>
                  <span className="shrink-0 text-xs text-slate-400">
                    {relativeTime(item.lastMessageAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{item.reason}</p>
                <p className="mt-1.5 text-xs font-semibold text-blue-600">{ctaLabel(item)}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {topActions.length === 0 && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-700">You're all caught up</p>
          <p className="mt-1 text-xs text-slate-500">Nothing needs attention right now.</p>
        </div>
      )}

      {/* Follow-ups */}
      {followUps.length > 0 && (
        <details className="mb-3 overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
          <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold uppercase tracking-wide text-amber-700 hover:bg-amber-100">
            Follow-ups queued ({followUps.length})
          </summary>
          <ul className="divide-y divide-amber-100 border-t border-amber-100">
            {followUps.map((c) => (
              <li key={c.id}>
                <Link
                  href={c.href}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-amber-100"
                >
                  <span className="font-medium text-amber-900">{c.displayName}</span>
                  <span className="text-xs text-amber-600">
                    Queued {c.scheduledAt.toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Safely ignored */}
      {ignoredItems.length > 0 && (
        <details className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700">
            Safely ignored ({ignoredItems.length})
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {ignoredItems.map((c) => (
              <li key={c.id}>
                <Link
                  href={c.href}
                  className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-700">{c.displayName}</span>
                  {c.reason && (
                    <span className="shrink-0 text-xs text-slate-400">{c.reason}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add app/components/HomeCommandCenter.tsx
git commit -m "feat: add HomeCommandCenter component (replaces stats panel)"
```

---

## Task 5: Refactor `app/inbox/page.tsx`

**Files:**
- Modify: `app/inbox/page.tsx`

The page now renders a desktop shell (rail + list column + main pane) and a mobile layout (existing). The main pane on desktop always shows `HomeCommandCenter`. The filtered email list lives in `AppListColumn`. The mobile layout keeps the full-page list view.

- [ ] **Step 1: Replace the full file**

```tsx
// app/inbox/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Suspense } from "react";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/app/inbox/SignOutButton";
import SearchInput from "@/app/inbox/SearchInput";
import AutoRefresh from "@/app/components/AutoRefresh";
import { StatusBadge, LabelBadge } from "@/app/components/badges";
import AppRail from "@/app/components/AppRail";
import AppListColumn from "@/app/components/AppListColumn";
import HomeCommandCenter from "@/app/components/HomeCommandCenter";
import { buildDailyCommandCenter, CommandCenterInputConversation } from "@/lib/agent/command-center";
import { analyzeRevenueAtRisk } from "@/lib/agent/revenue-at-risk";
import { AppNavigationItem, getInboxNavigation } from "@/lib/app-navigation";
import { stripHtmlToText } from "@/lib/email-body";

export const dynamic = "force-dynamic";

type ConversationStatus = "needs_reply" | "in_progress" | "closed";

const STATUS_LABELS: Record<ConversationStatus, string> = {
  needs_reply: "Needs Reply",
  in_progress: "In Progress",
  closed: "Closed",
};

const ALL_STATUSES = Object.keys(STATUS_LABELS) as ConversationStatus[];

const AUTOMATED_SENDER_RE =
  /\b(no-?reply|noreply|notifications?|alerts?|do-not-reply|automated)\b/i;
const AUTOMATED_BODY_RE =
  /\b(unsubscribe|you'?re receiving this|this is an automated (email|message|notification)|do not reply to this email)\b/i;
const FYI_RE =
  /\b(fyi|newsletter|for your records|no action|all set|thanks, all set)\b/i;

function isFyiConversation(conversation: {
  status: string;
  stateRecord: { state: string; metadataJson: unknown } | null;
  contact: { phoneE164: string } | null;
  messages: { direction: string; body: string }[];
}): boolean {
  if (conversation.stateRecord?.state === "fyi_only") return true;
  const meta = conversation.stateRecord?.metadataJson;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const emailType = (meta as Record<string, unknown>).emailType;
    if (
      emailType === "notification" ||
      emailType === "newsletter" ||
      emailType === "marketing"
    )
      return true;
  }
  if (conversation.status !== "needs_reply") return false;
  const msg = conversation.messages[0];
  if (!msg || msg.direction !== "inbound") return false;
  const email = conversation.contact?.phoneE164 ?? "";
  return (
    AUTOMATED_SENDER_RE.test(email) ||
    AUTOMATED_BODY_RE.test(msg.body) ||
    FYI_RE.test(msg.body)
  );
}

interface Props {
  searchParams: { status?: string; q?: string; sales?: string };
}

export default async function InboxPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const tenantId = session.user.tenantId;
  const activeStatus = ALL_STATUSES.includes(
    searchParams.status as ConversationStatus
  )
    ? (searchParams.status as ConversationStatus)
    : null;
  const q = searchParams.q?.trim() ?? "";
  const salesFilter = searchParams.sales === "1";
  const isHomeView = !searchParams.status && !salesFilter && !q;

  const [tenant, statusCounts] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { accountType: true },
    }),
    prisma.conversation.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { status: true },
    }),
  ]);

  const isBusiness = tenant?.accountType === "business";
  const accountType = tenant?.accountType ?? "personal";

  const countByStatus = Object.fromEntries(
    statusCounts.map((r) => [r.status, r._count.status])
  ) as Record<string, number>;
  const totalCount = statusCounts.reduce((sum, r) => sum + r._count.status, 0);
  const needsReplyCount = countByStatus["needs_reply"] ?? 0;

  // Fetch email list for mobile non-home views
  const mobileConversations =
    !isHomeView
      ? await prisma.conversation.findMany({
          where: {
            tenantId,
            ...(activeStatus ? { status: activeStatus } : {}),
            ...(q
              ? {
                  OR: [
                    {
                      externalThreadId: { contains: q, mode: "insensitive" as const },
                    },
                    {
                      contact: { name: { contains: q, mode: "insensitive" as const } },
                    },
                  ],
                }
              : {}),
          },
          orderBy: { lastMessageAt: "desc" },
          include: {
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
            channel: true,
            contact: true,
            stateRecord: { select: { metadataJson: true, state: true } },
          },
        })
      : [];

  // Home view data for command center
  const [commandCenterConversations, ignoredStates, pendingFollowUps, revenueAtRisk] =
    isHomeView
      ? await Promise.all([
          prisma.conversation.findMany({
            where: { tenantId },
            orderBy: { lastMessageAt: "desc" },
            take: 75,
            include: {
              messages: { orderBy: { createdAt: "asc" }, take: 20 },
              channel: true,
              contact: true,
              draft: true,
              agentJobs: { orderBy: { createdAt: "desc" }, take: 3 },
              approvalRequests: {
                where: { status: "pending" },
                orderBy: { createdAt: "desc" },
                take: 3,
              },
              calendarHolds: {
                where: { status: "held" },
                orderBy: { expiresAt: "asc" },
                take: 3,
              },
              leads: {
                select: {
                  score: true,
                  scoreExplanation: true,
                  estimatedValue: true,
                },
                take: 1,
              },
              stateRecord: { select: { metadataJson: true } },
            },
          }),
          prisma.conversationState.findMany({
            where: { tenantId },
            include: { conversation: { include: { contact: true } } },
            orderBy: { updatedAt: "desc" },
            take: 200,
          }),
          prisma.agentJob.findMany({
            where: {
              tenantId,
              trigger: { in: ["follow_up", "lead_follow_up"] },
              status: { in: ["pending", "running"] },
            },
            include: { conversation: { include: { contact: true } } },
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          isBusiness
            ? analyzeRevenueAtRisk(tenantId)
            : Promise.resolve([] as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>),
        ])
      : [[], [], [], [] as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>];

  type ConversationForBrief = CommandCenterInputConversation & {
    stateRecord: { metadataJson: unknown } | null;
    leads: {
      score: number;
      scoreExplanation: string | null;
      estimatedValue: number | null;
    }[];
  };

  const commandCenter = isHomeView
    ? buildDailyCommandCenter(
        (commandCenterConversations as ConversationForBrief[]).map((c) => ({
          ...c,
          conversationState: c.stateRecord,
          lead: c.leads[0] ?? null,
        })),
        new Date(),
        accountType
      )
    : null;

  type IgnoredStateRow = {
    metadataJson: unknown;
    conversationId: string;
    conversation: { contact: { name: string } | null; externalThreadId: string };
    reason: string | null;
  };

  type FollowUpJobRow = {
    conversationId: string;
    conversation: {
      contact: { name: string } | null;
      externalThreadId: string;
      lastMessageAt: Date;
    };
    createdAt: Date;
  };

  const ignoredConversations = (ignoredStates as IgnoredStateRow[])
    .filter((s) => {
      const meta = s.metadataJson as Record<string, unknown> | null;
      return meta?.safelyIgnored === true;
    })
    .map((s) => ({
      id: s.conversationId,
      displayName:
        s.conversation.contact?.name ?? s.conversation.externalThreadId,
      reason: s.reason,
      href: `/conversations/${s.conversationId}`,
    }));

  const followUpConversations = (pendingFollowUps as FollowUpJobRow[]).map(
    (job) => ({
      id: job.conversationId,
      displayName:
        job.conversation.contact?.name ?? job.conversation.externalThreadId,
      scheduledAt: job.createdAt,
      href: `/conversations/${job.conversationId}`,
    })
  );

  const displayConversations = salesFilter
    ? mobileConversations.filter((c) => {
        const meta = c.stateRecord?.metadataJson;
        return (
          meta !== null &&
          typeof meta === "object" &&
          !Array.isArray(meta) &&
          (meta as Record<string, unknown>).isSalesLead === true
        );
      })
    : mobileConversations;

  const appNavigation = getInboxNavigation(tenant?.accountType);

  function navLink(item: AppNavigationItem, className = "") {
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 ${className}`}
      >
        {item.label}
      </Link>
    );
  }

  function secondaryNavMenu(className = "") {
    if (appNavigation.secondary.length === 0) return null;
    return (
      <details className={`relative ${className}`}>
        <summary className="cursor-pointer list-none rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
          More
        </summary>
        <div className="absolute right-0 z-10 mt-2 min-w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {appNavigation.secondary.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </details>
    );
  }

  const listTabs = [
    { label: "All", status: "all" as const, count: totalCount },
    ...ALL_STATUSES.map((s) => ({
      label: STATUS_LABELS[s],
      status: s,
      count: countByStatus[s] ?? 0,
    })),
  ];

  function tabHref(
    status: ConversationStatus | "all" | null,
    sales = false
  ) {
    const params = new URLSearchParams();
    if (sales) {
      params.set("sales", "1");
    } else if (status) {
      params.set("status", status);
    }
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  }

  return (
    <>
      <AutoRefresh intervalMs={10000} />

      {/* ── DESKTOP SHELL (lg+) ── */}
      <div className="hidden lg:flex h-screen overflow-hidden bg-slate-50">
        <AppRail needsReplyCount={needsReplyCount} accountType={accountType} />
        <AppListColumn
          tenantId={tenantId}
          accountType={accountType}
          status={activeStatus}
          q={q || undefined}
        />
        {/* Main pane: always shows the command center on the inbox route */}
        <main className="flex-1 overflow-y-auto bg-slate-50">
          {commandCenter ? (
            <HomeCommandCenter
              commandCenter={commandCenter}
              revenueAtRisk={revenueAtRisk as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>}
              followUps={followUpConversations}
              ignoredItems={ignoredConversations}
              accountType={accountType}
              date={new Date()}
            />
          ) : (
            /* Non-home view on desktop: still show command center from a fresh fetch */
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700">
                  Select a conversation from the list
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  or{" "}
                  <Link href="/inbox" className="text-blue-600 hover:underline">
                    go to Home
                  </Link>
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── MOBILE LAYOUT (< lg) ── */}
      <div className="lg:hidden min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="flex items-center justify-between py-4">
              <div>
                <h1 className="text-xl font-semibold">Inbox</h1>
                <p className="text-sm text-slate-500">
                  {needsReplyCount > 0 ? (
                    <span className="font-medium text-red-600">
                      {needsReplyCount} need{needsReplyCount === 1 ? "s" : ""} reply
                    </span>
                  ) : (
                    "All caught up"
                  )}
                  {" · "}
                  {totalCount} total
                </p>
              </div>
              <div className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:flex">
                {appNavigation.primary.map((item) => navLink(item))}
                {secondaryNavMenu()}
                <SignOutButton />
              </div>
              <div className="sm:hidden">
                <SignOutButton />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1 pb-3 sm:hidden">
              {appNavigation.primary.map((item) => navLink(item, "shrink-0"))}
              {secondaryNavMenu("shrink-0")}
            </div>
          </div>

          {/* View tabs */}
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <nav className="-mb-px flex gap-6 overflow-x-auto">
              <Link
                href="/inbox"
                className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
                  isHomeView
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                Home
              </Link>
              {listTabs.map(({ label, status, count }) => {
                const isActive =
                  !isHomeView &&
                  !salesFilter &&
                  (status === "all"
                    ? activeStatus === null
                    : activeStatus === status);
                return (
                  <Link
                    key={label}
                    href={tabHref(status)}
                    className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
                      isActive
                        ? "border-slate-900 text-slate-900"
                        : "border-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span
                        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                          isActive
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
              {isBusiness && (
                <Link
                  href={tabHref(null, true)}
                  className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
                    salesFilter
                      ? "border-emerald-600 text-emerald-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Sales
                </Link>
              )}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
          {isHomeView ? (
            <>
              {commandCenter && (
                <HomeCommandCenter
                  commandCenter={commandCenter}
                  revenueAtRisk={revenueAtRisk as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>}
                  followUps={followUpConversations}
                  ignoredItems={ignoredConversations}
                  accountType={accountType}
                  date={new Date()}
                />
              )}
            </>
          ) : (
            <>
              <div className="mb-5">
                <Suspense>
                  <SearchInput defaultValue={q} />
                </Suspense>
              </div>
              <div className="space-y-3">
                {displayConversations.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-sm text-slate-500">
                    {q || activeStatus || salesFilter
                      ? "No conversations match your search."
                      : "No conversations yet. Connect Gmail in Settings to import threads."}
                  </div>
                ) : (
                  displayConversations.map((conversation) => {
                    const lastMessage = conversation.messages[0];
                    const displayName =
                      conversation.contact?.name ?? conversation.externalThreadId;
                    const snippet = lastMessage?.body
                      ? stripHtmlToText(lastMessage.body, 100)
                      : "No messages yet";
                    return (
                      <Link
                        key={conversation.id}
                        href={`/conversations/${conversation.id}`}
                        className="block rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 sm:px-5 sm:py-4"
                      >
                        <div className="flex items-start justify-between gap-2 sm:items-center">
                          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5 sm:gap-y-0">
                            <p
                              className="min-w-0 truncate text-sm font-medium"
                              title={displayName}
                            >
                              {displayName}
                            </p>
                            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                              <StatusBadge
                                status={
                                  isFyiConversation(conversation)
                                    ? "closed"
                                    : conversation.status
                                }
                              />
                              {isBusiness && conversation.label && (
                                <LabelBadge label={conversation.label} />
                              )}
                            </div>
                          </div>
                          <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                            {conversation.lastMessageAt.toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-500">{snippet}</p>
                      </Link>
                    );
                  })
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add app/inbox/page.tsx
git commit -m "feat: add desktop shell to inbox page with HomeCommandCenter"
```

---

## Task 6: Redirect `/digest` to `/inbox`

**Files:**
- Modify: `app/digest/page.tsx`

- [ ] **Step 1: Replace the file content with a redirect**

```tsx
// app/digest/page.tsx
import { redirect } from "next/navigation"

export default function DigestPage() {
  redirect("/inbox")
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
git add app/digest/page.tsx
git commit -m "feat: redirect /digest to /inbox (home is now the command center)"
```

---

## Task 7: Refactor conversation page — shell + new layout

**Files:**
- Modify: `app/conversations/[id]/page.tsx`

The conversation page gains the desktop shell (rail + list column), a simplified header, and an updated two-column layout (`thread+composer | sidebar`). The thread and reply composer become one continuous section.

- [ ] **Step 1: Replace the full file**

```tsx
// app/conversations/[id]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AIDraftPanel from "@/app/conversations/[id]/AIDraftPanel";
import CalendarHoldPanel from "@/app/conversations/[id]/CalendarHoldPanel";
import ExplainThreadPanel from "@/app/conversations/[id]/ExplainThreadPanel";
import HandleThisPanel from "@/app/conversations/[id]/HandleThisPanel";
import WorkItemsPanel from "@/app/conversations/[id]/WorkItemsPanel";
import SendBox from "@/app/conversations/[id]/SendBox";
import StatusButton from "@/app/conversations/[id]/StatusButton";
import LabelSelect from "@/app/conversations/[id]/LabelSelect";
import SaveContactForm from "@/app/conversations/[id]/SaveContactForm";
import AutoDraftTrigger from "@/app/conversations/[id]/AutoDraftTrigger";
import AutoRefresh from "@/app/components/AutoRefresh";
import CollapsibleCard from "@/app/components/CollapsibleCard";
import { StatusBadge, LabelBadge } from "@/app/components/badges";
import AppRail from "@/app/components/AppRail";
import AppListColumn from "@/app/components/AppListColumn";
import {
  analyzeConversationForCommandCenter,
  buildRelationshipContext,
} from "@/lib/agent/command-center";
import { syncConversationWorkItems } from "@/lib/agent/work-item-sync";
import SupportPanel from "@/app/conversations/[id]/SupportPanel";
import SalesPanel from "@/app/conversations/[id]/SalesPanel";
import { SALES_SUGGESTED_ACTIONS } from "@/lib/agent/sales-classifier";
import EmailBody from "@/app/components/EmailBody";
import { resolveAccountMode } from "@/lib/account-mode";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const accountMode = resolveAccountMode(
    (session.user as Record<string, unknown>).accountType
  );
  const isPersonal = accountMode === "personal";
  const accountType = (session.user as Record<string, unknown>).accountType as
    | string
    | null;

  const [
    conversation,
    businessProfile,
    knowledgeDocumentCount,
    latestAgentJob,
    activeHold,
    pendingApprovals,
    pendingFollowUpJob,
    needsReplyCount,
  ] = await Promise.all([
    prisma.conversation.findFirst({
      where: { id: params.id, tenantId: session.user.tenantId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        channel: true,
        contact: true,
        draft: true,
      },
    }),
    prisma.businessProfile.findUnique({
      where: { tenantId: session.user.tenantId },
      select: { id: true },
    }),
    prisma.knowledgeDocument.count({
      where: { tenantId: session.user.tenantId },
    }),
    prisma.agentJob.findFirst({
      where: {
        conversationId: params.id,
        tenantId: session.user.tenantId,
        status: "completed",
      },
      orderBy: { completedAt: "desc" },
    }),
    prisma.calendarHold.findFirst({
      where: {
        conversationId: params.id,
        tenantId: session.user.tenantId,
        status: "held",
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.approvalRequest.findMany({
      where: {
        conversationId: params.id,
        tenantId: session.user.tenantId,
        status: "pending",
      },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    prisma.agentJob.findFirst({
      where: {
        conversationId: params.id,
        tenantId: session.user.tenantId,
        trigger: "follow_up",
        status: "pending",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    prisma.conversation.count({
      where: { tenantId: session.user.tenantId, status: "needs_reply" },
    }),
  ]);

  if (!conversation) notFound();

  await syncConversationWorkItems({
    tenantId: session.user.tenantId,
    conversationId: conversation.id,
  }).catch(() => null);

  const [stateRecord, inboxTasks, lead, personMemory] = await Promise.all([
    prisma.conversationState.findUnique({
      where: { conversationId: conversation.id },
      select: {
        state: true,
        priority: true,
        reason: true,
        nextAction: true,
        confidence: true,
        metadataJson: true,
      },
    }),
    prisma.inboxTask.findMany({
      where: {
        tenantId: session.user.tenantId,
        conversationId: conversation.id,
        status: "open",
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, title: true, status: true, dueAt: true },
    }),
    prisma.lead.findUnique({
      where: {
        tenantId_conversationId: {
          tenantId: session.user.tenantId,
          conversationId: conversation.id,
        },
      },
      select: {
        id: true,
        name: true,
        company: true,
        need: true,
        urgency: true,
        budgetClue: true,
        nextAction: true,
        score: true,
        stage: true,
      },
    }),
    conversation.contactId
      ? prisma.personMemory.findUnique({
          where: { contactId: conversation.contactId },
          select: {
            summary: true,
            preferences: true,
            openQuestions: true,
            promisedActions: true,
            lastContactAt: true,
            messageCount: true,
          },
        })
      : null,
  ]);

  const convMeta =
    stateRecord?.metadataJson &&
    typeof stateRecord.metadataJson === "object" &&
    !Array.isArray(stateRecord.metadataJson)
      ? (stateRecord.metadataJson as Record<string, unknown>)
      : {};

  const isSupport = convMeta.isSupport === true;
  const churnRisk = convMeta.churnRisk === true;
  const needsEscalation = convMeta.needsEscalation === true;
  const suggestedKbDocId =
    typeof convMeta.suggestedKbDocId === "string"
      ? convMeta.suggestedKbDocId
      : null;

  const isSalesLead = convMeta.isSalesLead === true;
  const closingStage =
    typeof convMeta.closingStage === "string"
      ? convMeta.closingStage
      : "prospect";
  const extractedBudget =
    typeof convMeta.extractedBudget === "string"
      ? convMeta.extractedBudget
      : null;
  const extractedTimeline =
    typeof convMeta.extractedTimeline === "string"
      ? convMeta.extractedTimeline
      : null;
  const salesSuggestedAction = isSalesLead
    ? (SALES_SUGGESTED_ACTIONS[
        closingStage as keyof typeof SALES_SUGGESTED_ACTIONS
      ] ?? "")
    : "";

  const suggestedKbDoc = suggestedKbDocId
    ? await prisma.knowledgeDocument.findFirst({
        where: { id: suggestedKbDocId, tenantId: session.user.tenantId },
        select: { id: true, title: true, content: true, sourceType: true },
      })
    : null;

  const shouldAutoFollowUp =
    Boolean(pendingFollowUpJob) &&
    !conversation.draft &&
    conversation.channel.type === "email" &&
    (isPersonal || Boolean(businessProfile));
  const canSuggestReply =
    conversation.channel.type === "email" &&
    (isPersonal || Boolean(businessProfile));

  const displayName =
    conversation.contact?.name ?? conversation.externalThreadId;
  const emailType =
    typeof convMeta.emailType === "string" ? convMeta.emailType : null;
  const isAutoEmailConversation =
    emailType === "notification" ||
    emailType === "newsletter" ||
    emailType === "marketing";

  const assistantInput = {
    id: conversation.id,
    externalThreadId: conversation.externalThreadId,
    label: conversation.label,
    status: conversation.status,
    lastMessageAt: conversation.lastMessageAt,
    contact: conversation.contact,
    channel: conversation.channel,
    messages: conversation.messages,
    draft: conversation.draft,
    agentJobs: latestAgentJob ? [latestAgentJob] : [],
    approvalRequests: pendingApprovals,
    calendarHolds: activeHold ? [activeHold] : [],
    conversationState: stateRecord ?? null,
  };
  const assistantState = analyzeConversationForCommandCenter(
    assistantInput,
    new Date(),
    accountMode
  );
  const relationshipContext = buildRelationshipContext(
    assistantInput,
    new Date(),
    accountMode
  );
  const draftMetadata = (
    conversation.draft as {
      metadataJson?: {
        intent?: unknown;
        confidence?: unknown;
        riskLevel?: unknown;
        suggestedLabel?: unknown;
        escalationReason?: unknown;
      } | null;
    } | null
  )?.metadataJson;

  return (
    <>
      <AutoRefresh intervalMs={8000} />
      {shouldAutoFollowUp && (
        <AutoDraftTrigger conversationId={conversation.id} />
      )}

      {/* ── DESKTOP SHELL (lg+) ── */}
      <div className="hidden lg:flex h-screen overflow-hidden bg-slate-50">
        <AppRail needsReplyCount={needsReplyCount} accountType={accountType} />
        <AppListColumn
          tenantId={session.user.tenantId}
          accountType={accountType}
          activeConversationId={conversation.id}
        />

        {/* Main pane: thread + sidebar */}
        <div className="flex flex-1 min-w-0 overflow-hidden">
          {/* Thread + composer */}
          <div className="flex flex-1 min-w-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
            {/* Conversation header */}
            <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="min-w-0 truncate text-base font-bold text-slate-900">
                      {displayName}
                    </h1>
                    <StatusBadge
                      status={
                        isAutoEmailConversation ||
                        stateRecord?.state === "fyi_only"
                          ? "closed"
                          : conversation.status
                      }
                    />
                    {conversation.label && !isPersonal && (
                      <LabelBadge label={conversation.label} />
                    )}
                  </div>
                  <p className="min-w-0 break-all text-xs text-slate-500">
                    {conversation.channel.emailAddress ??
                      conversation.externalThreadId}
                  </p>
                </div>
                <StatusButton
                  conversationId={conversation.id}
                  currentStatus={conversation.status}
                />
              </div>
            </div>

            {/* Messages — scrollable */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="mx-auto max-w-2xl space-y-4">
                {conversation.messages.length === 0 ? (
                  <p className="text-sm text-slate-500">No messages yet.</p>
                ) : (
                  conversation.messages.map((message) => {
                    const isOutbound = message.direction === "outbound";
                    return (
                      <article
                        key={message.id}
                        className={`overflow-hidden rounded-xl border px-5 py-4 ${
                          isOutbound
                            ? "border-blue-100 bg-blue-50"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                              {isOutbound ? "Me" : initialsFor(message.fromE164)}
                            </div>
                            <div className="min-w-0">
                              <p className="min-w-0 break-all font-semibold text-slate-900 text-xs">
                                {isOutbound ? "You" : message.fromE164}
                              </p>
                              <p className="min-w-0 break-all text-[11px] text-slate-500">
                                To: {message.toE164}
                              </p>
                            </div>
                          </div>
                          <time
                            className="shrink-0 text-[11px] text-slate-400"
                            dateTime={message.createdAt.toISOString()}
                          >
                            {message.createdAt.toLocaleString()}
                          </time>
                        </div>
                        <div className="min-w-0 text-sm leading-relaxed text-slate-900">
                          <EmailBody body={message.body} />
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            {/* Reply composer — flows directly below messages */}
            <div className="mx-auto w-full max-w-2xl shrink-0 border-t-2 border-slate-200 bg-white px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  Reply to {displayName}
                </h2>
                {conversation.draft &&
                  conversation.draft.status !== "none" && (
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-700">
                      {conversation.draft.status === "sent"
                        ? "Sent"
                        : "Draft ready"}
                    </span>
                  )}
              </div>
              <AIDraftPanel
                conversationId={conversation.id}
                channelType={conversation.channel.type}
                canSuggest={canSuggestReply}
                knowledgeDocumentCount={knowledgeDocumentCount}
                isPersonal={isPersonal}
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
                inline
              />
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Or send directly
                </p>
                <SendBox conversationId={conversation.id} />
              </div>
            </div>
          </div>

          {/* Compact context sidebar */}
          <aside className="w-60 shrink-0 overflow-y-auto bg-slate-50 p-3 space-y-2.5">
            {/* Contact */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Contact
              </p>
              {conversation.contact ? (
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-semibold text-slate-800"
                    title={conversation.contact.name}
                  >
                    {conversation.contact.name}
                  </p>
                  {conversation.contact.phoneE164 && (
                    <p
                      className="break-all text-[11px] text-slate-500"
                      title={conversation.contact.phoneE164}
                    >
                      {conversation.contact.phoneE164}
                    </p>
                  )}
                </div>
              ) : conversation.channel.type === "email" ? (
                <p className="text-xs text-slate-500">No contact saved</p>
              ) : (
                <SaveContactForm
                  conversationId={conversation.id}
                  phoneE164={conversation.externalThreadId}
                />
              )}
              {!isPersonal && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <LabelSelect
                    conversationId={conversation.id}
                    currentLabel={conversation.label}
                    isPersonal={isPersonal}
                  />
                </div>
              )}
            </div>

            {/* Why this matters / assistant context */}
            {isAutoEmailConversation ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-700">
                  No reply needed
                </p>
                <p className="mt-1 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                  {emailType === "notification"
                    ? "This is an automated notification."
                    : emailType === "newsletter"
                      ? "This is a newsletter or marketing email."
                      : "This is a promotional email."}
                </p>
              </div>
            ) : (
              <HandleThisPanel
                conversationId={conversation.id}
                assistantState={assistantState}
                relationshipContext={relationshipContext}
                canSuggest={canSuggestReply}
                isPersonal={isPersonal}
              />
            )}

            {/* Business-only panels */}
            {isSupport && !isPersonal && (
              <SupportPanel
                conversationId={conversation.id}
                isSupport={isSupport}
                churnRisk={churnRisk}
                needsEscalation={needsEscalation}
                suggestedKbDoc={suggestedKbDoc}
                repeatContactCount={0}
              />
            )}
            {isSalesLead && !isPersonal && (
              <SalesPanel
                conversationId={conversation.id}
                closingStage={closingStage}
                extractedBudget={extractedBudget}
                extractedTimeline={extractedTimeline}
                suggestedAction={salesSuggestedAction}
              />
            )}
            {conversation.channel.type === "email" && !isPersonal && (
              <CalendarHoldPanel
                conversationId={conversation.id}
                availableSlots={
                  Array.isArray(latestAgentJob?.slotsJson)
                    ? (latestAgentJob.slotsJson as string[])
                    : []
                }
                primaryCalendarEmail={
                  (
                    businessProfile as {
                      primaryCalendarEmail?: string | null;
                    } | null
                  )?.primaryCalendarEmail ?? null
                }
                activeHold={activeHold}
              />
            )}

            {/* Explain thread */}
            <ExplainThreadPanel conversationId={conversation.id} />

            {/* Collapsible: Work items */}
            <CollapsibleCard title="Work items">
              <WorkItemsPanel
                state={stateRecord}
                tasks={inboxTasks}
                lead={lead}
                isPersonal={isPersonal}
                bare
              />
            </CollapsibleCard>

            {/* Collapsible: Relationship */}
            {personMemory && (
              <CollapsibleCard title="Relationship">
                <div className="min-w-0 space-y-3 break-words text-xs text-slate-600 leading-relaxed [overflow-wrap:anywhere]">
                  <p>{personMemory.summary}</p>
                  {personMemory.promisedActions && (
                    <div>
                      <p className="mb-1 font-semibold text-slate-500">
                        Promises made
                      </p>
                      <p className="whitespace-pre-line">
                        {personMemory.promisedActions}
                      </p>
                    </div>
                  )}
                  {personMemory.openQuestions && (
                    <div>
                      <p className="mb-1 font-semibold text-slate-500">
                        Open questions
                      </p>
                      <p className="whitespace-pre-line">
                        {personMemory.openQuestions}
                      </p>
                    </div>
                  )}
                  {personMemory.preferences && (
                    <div>
                      <p className="mb-1 font-semibold text-slate-500">
                        Preferences
                      </p>
                      <p className="whitespace-pre-line">
                        {personMemory.preferences}
                      </p>
                    </div>
                  )}
                </div>
              </CollapsibleCard>
            )}
          </aside>
        </div>
      </div>

      {/* ── MOBILE LAYOUT (< lg) ── */}
      <div className="lg:hidden min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between px-4 sm:px-6 py-4">
            <div>
              <Link
                href="/inbox"
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                ← Back to inbox
              </Link>
              <div className="mt-1 flex items-center gap-2">
                <h1 className="text-xl font-semibold">{displayName}</h1>
                <StatusBadge
                  status={
                    isAutoEmailConversation ||
                    stateRecord?.state === "fyi_only"
                      ? "closed"
                      : conversation.status
                  }
                />
                {conversation.label && !isPersonal && (
                  <LabelBadge label={conversation.label} />
                )}
              </div>
              <p className="min-w-0 break-all text-sm text-slate-500">
                {conversation.channel.emailAddress ??
                  conversation.externalThreadId}
              </p>
            </div>
            <StatusButton
              conversationId={conversation.id}
              currentStatus={conversation.status}
            />
          </div>
        </header>

        <main className="mx-auto grid max-w-[1200px] gap-6 px-4 sm:px-6 py-6 lg:grid-cols-[1fr_320px]">
          {/* Thread + composer */}
          <section className="min-w-0 space-y-4 overflow-hidden">
            <div className="overflow-x-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-5">
                <h2 className="mt-1 min-w-0 break-words text-lg font-semibold text-slate-950 [overflow-wrap:anywhere]">
                  {displayName}
                </h2>
                <p className="mt-1 min-w-0 break-all text-sm text-slate-500">
                  {conversation.channel.emailAddress
                    ? `Inbox: ${conversation.channel.emailAddress}`
                    : `Thread: ${conversation.externalThreadId}`}
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {conversation.messages.length === 0 ? (
                  <p className="px-6 py-5 text-sm text-slate-500">
                    No messages yet.
                  </p>
                ) : (
                  conversation.messages.map((message) => {
                    const isOutbound = message.direction === "outbound";
                    return (
                      <article key={message.id} className="px-6 py-5">
                        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-start">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                            {isOutbound ? "Me" : initialsFor(message.fromE164)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                              <p className="min-w-0 break-all font-semibold text-slate-900">
                                {isOutbound ? "You" : message.fromE164}
                              </p>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                                {isOutbound ? "Sent" : "Received"}
                              </span>
                            </div>
                            <p className="mt-1 min-w-0 break-all text-xs text-slate-500">
                              To: {message.toE164}
                            </p>
                          </div>
                          <time
                            className="text-xs text-slate-400 sm:text-right"
                            dateTime={message.createdAt.toISOString()}
                          >
                            {message.createdAt.toLocaleString()}
                          </time>
                        </div>
                        <div className="min-w-0 text-sm leading-6 text-slate-900">
                          <EmailBody body={message.body} />
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            {/* Reply composer */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-3">
                <h2 className="text-sm font-semibold text-slate-800">Reply</h2>
                <p className="text-xs text-slate-500">
                  Review and approve before anything is sent.
                </p>
              </div>
              <div className="px-6 py-5">
                <AIDraftPanel
                  conversationId={conversation.id}
                  channelType={conversation.channel.type}
                  canSuggest={canSuggestReply}
                  knowledgeDocumentCount={knowledgeDocumentCount}
                  isPersonal={isPersonal}
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
                  inline
                />
              </div>
              <div className="border-t border-slate-100 bg-slate-50 px-6 py-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Or send directly
                </p>
                <SendBox conversationId={conversation.id} />
              </div>
            </div>
          </section>

          {/* Mobile sidebar */}
          <aside className="min-w-0 space-y-3">
            <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Contact
              </p>
              {conversation.contact ? (
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-medium text-slate-800"
                    title={conversation.contact.name}
                  >
                    {conversation.contact.name}
                  </p>
                  {conversation.contact.phoneE164 && (
                    <p
                      className="truncate text-xs text-slate-500"
                      title={conversation.contact.phoneE164}
                    >
                      {conversation.contact.phoneE164}
                    </p>
                  )}
                </div>
              ) : conversation.channel.type === "email" ? (
                <p className="text-xs text-slate-500">No contact saved</p>
              ) : (
                <SaveContactForm
                  conversationId={conversation.id}
                  phoneE164={conversation.externalThreadId}
                />
              )}
              {!isPersonal && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <LabelSelect
                    conversationId={conversation.id}
                    currentLabel={conversation.label}
                    isPersonal={isPersonal}
                  />
                </div>
              )}
            </div>
            {isAutoEmailConversation ? (
              <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                <p className="font-medium text-slate-700">No reply needed</p>
                <p className="mt-1 break-words [overflow-wrap:anywhere]">
                  {emailType === "notification"
                    ? "This is an automated notification."
                    : emailType === "newsletter"
                      ? "This is a newsletter or marketing email."
                      : "This is a promotional email."}
                </p>
              </div>
            ) : (
              <HandleThisPanel
                conversationId={conversation.id}
                assistantState={assistantState}
                relationshipContext={relationshipContext}
                canSuggest={canSuggestReply}
                isPersonal={isPersonal}
              />
            )}
            {isSupport && !isPersonal && (
              <SupportPanel
                conversationId={conversation.id}
                isSupport={isSupport}
                churnRisk={churnRisk}
                needsEscalation={needsEscalation}
                suggestedKbDoc={suggestedKbDoc}
                repeatContactCount={0}
              />
            )}
            {isSalesLead && !isPersonal && (
              <SalesPanel
                conversationId={conversation.id}
                closingStage={closingStage}
                extractedBudget={extractedBudget}
                extractedTimeline={extractedTimeline}
                suggestedAction={salesSuggestedAction}
              />
            )}
            {conversation.channel.type === "email" && !isPersonal && (
              <CalendarHoldPanel
                conversationId={conversation.id}
                availableSlots={
                  Array.isArray(latestAgentJob?.slotsJson)
                    ? (latestAgentJob.slotsJson as string[])
                    : []
                }
                primaryCalendarEmail={
                  (
                    businessProfile as {
                      primaryCalendarEmail?: string | null;
                    } | null
                  )?.primaryCalendarEmail ?? null
                }
                activeHold={activeHold}
              />
            )}
            <ExplainThreadPanel conversationId={conversation.id} />
            <CollapsibleCard title="Work items">
              <WorkItemsPanel
                state={stateRecord}
                tasks={inboxTasks}
                lead={lead}
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
                      <p className="mb-1 font-semibold text-slate-500">
                        Promises made
                      </p>
                      <p className="whitespace-pre-line">
                        {personMemory.promisedActions}
                      </p>
                    </div>
                  )}
                  {personMemory.openQuestions && (
                    <div>
                      <p className="mb-1 font-semibold text-slate-500">
                        Open questions
                      </p>
                      <p className="whitespace-pre-line">
                        {personMemory.openQuestions}
                      </p>
                    </div>
                  )}
                  {personMemory.preferences && (
                    <div>
                      <p className="mb-1 font-semibold text-slate-500">
                        Preferences
                      </p>
                      <p className="whitespace-pre-line">
                        {personMemory.preferences}
                      </p>
                    </div>
                  )}
                </div>
              </CollapsibleCard>
            )}
          </aside>
        </main>
      </div>
    </>
  );
}

function initialsFor(value: string): string {
  const name = value.replace(/<.*?>/g, "").trim() || value;
  const first = name.match(/[A-Za-z0-9]/)?.[0] ?? "?";
  return first.toUpperCase();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Fix any type errors.

- [ ] **Step 3: Commit**

```bash
git add app/conversations/[id]/page.tsx
git commit -m "feat: add desktop shell and new thread layout to conversation page"
```

---

## Task 8: Fix language in `HandleThisPanel`

**Files:**
- Modify: `app/conversations/[id]/HandleThisPanel.tsx`

Changes: rename heading "Assistant context" → "Why this matters"; button text "Handle this" → "Suggest reply" for personal, "Handle this" for business; remove the `handleThis` wrapper that duplicates the suggest endpoint (call the draft/suggest endpoint directly); fix personal-account copy.

- [ ] **Step 1: Replace the component**

```tsx
// app/conversations/[id]/HandleThisPanel.tsx
"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import type {
  CommandCenterConversation,
  RelationshipContext,
} from "@/lib/agent/command-center"

export default function HandleThisPanel({
  conversationId,
  assistantState,
  relationshipContext,
  canSuggest,
  isPersonal = false,
}: {
  conversationId: string
  assistantState: CommandCenterConversation
  relationshipContext: RelationshipContext
  canSuggest: boolean
  isPersonal?: boolean
}) {
  const router = useRouter()
  const [isHandling, setIsHandling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleThis() {
    if (!canSuggest || isHandling) return
    setIsHandling(true)
    setNotice(null)
    setError(null)
    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/draft/suggest`,
        { method: "POST" }
      )
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error ?? "Could not generate a reply suggestion.")
      }
      setNotice("Draft ready — review it in the reply area below.")
      router.refresh()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not generate a reply suggestion."
      )
    } finally {
      setIsHandling(false)
    }
  }

  const buttonLabel = isPersonal ? "Suggest reply" : "Handle this"

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Why this matters
        </h2>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-600">
          {assistantState.state.replaceAll("_", " ")}
        </span>
      </div>

      <p className="mb-3 min-w-0 break-words text-xs text-slate-600 [overflow-wrap:anywhere]">
        {assistantState.reason}
      </p>

      <button
        type="button"
        onClick={handleThis}
        disabled={!canSuggest || isHandling}
        className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isHandling ? "Working…" : buttonLabel}
      </button>

      {!canSuggest && (
        <p className="mt-2 text-xs text-amber-700">
          {isPersonal
            ? "Complete your writing style in Settings to enable AI suggestions."
            : "Add a business profile in Settings to enable AI suggestions."}
        </p>
      )}
      {notice && <p className="mt-2 text-xs text-emerald-700">{notice}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <dl className="mt-3 space-y-2 text-xs">
        <ContextRow label="Next step" value={assistantState.nextAction} />
        {assistantState.approvalReason && (
          <ContextRow label="Review note" value={assistantState.approvalReason} />
        )}
        <ContextRow label="Person" value={relationshipContext.name} />
        <ContextRow label="Summary" value={relationshipContext.lastConversationSummary} />
        <ContextRow label="Relationship" value={relationshipContext.relationshipStatus} />
        <ContextRow label="Tone" value={relationshipContext.tonePreference} />
      </dl>

      {relationshipContext.openTasks.length > 0 && (
        <ContextList title="Open tasks" items={relationshipContext.openTasks} />
      )}
      {!isPersonal && relationshipContext.moneySignals.length > 0 && (
        <ContextList title="Money signals" items={relationshipContext.moneySignals} />
      )}
      {relationshipContext.importantDetails.length > 0 && (
        <ContextList title="Details" items={relationshipContext.importantDetails} />
      )}
    </div>
  )
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-slate-800 [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  )
}

function ContextList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
      <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
        {items.map((item) => (
          <li key={item} className="min-w-0 break-words [overflow-wrap:anywhere]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/conversations/[id]/HandleThisPanel.tsx
git commit -m "fix: rename panel to 'Why this matters', fix personal-account language"
```

---

## Task 9: Fix personal language in `AIDraftPanel` and `WorkItemsPanel`

**Files:**
- Modify: `app/conversations/[id]/AIDraftPanel.tsx`
- Modify: `app/conversations/[id]/WorkItemsPanel.tsx`

### AIDraftPanel changes

- [ ] **Step 1: Update personal-account copy in AIDraftPanel**

In `app/conversations/[id]/AIDraftPanel.tsx`, find and replace two strings:

```tsx
// Find (line ~269):
{isPersonal
  ? "AI suggestions are temporarily unavailable for this account."
  : "Add a business profile in Settings to enable suggestions."}

// Replace with:
{isPersonal
  ? "AI suggestions are temporarily unavailable."
  : "Add a business profile in Settings to enable suggestions."}
```

```tsx
// Find (line ~276):
{isEmail && !isPersonal && canSuggest && knowledgeDocumentCount === 0 ? (
  <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
    No knowledge documents yet. Suggestions may be less specific.
  </p>
) : null}
```

Leave this block as-is (it's already gated on `!isPersonal`).

### WorkItemsPanel changes

- [ ] **Step 2: Update subtitle in WorkItemsPanel**

In `app/conversations/[id]/WorkItemsPanel.tsx`, find and replace:

```tsx
// Find:
<p className="mt-1 text-xs text-slate-500">
  Persisted state, tasks, and lead signals for this thread.
</p>

// Replace with:
<p className="mt-1 text-xs text-slate-500">
  {isPersonal ? "Tasks and context for this thread." : "Persisted state, tasks, and lead signals for this thread."}
</p>
```

- [ ] **Step 3: Commit**

```bash
git add app/conversations/[id]/AIDraftPanel.tsx app/conversations/[id]/WorkItemsPanel.tsx
git commit -m "fix: personal-account language in AIDraftPanel and WorkItemsPanel"
```

---

## Task 10: Delete old `CommandCenterPanel`

**Files:**
- Delete: `app/inbox/CommandCenterPanel.tsx`

- [ ] **Step 1: Remove the file**

```bash
git rm app/inbox/CommandCenterPanel.tsx
```

- [ ] **Step 2: Verify no remaining imports**

```bash
grep -r "CommandCenterPanel" /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox/app --include="*.tsx" --include="*.ts"
```

Expected: no results.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove CommandCenterPanel (replaced by HomeCommandCenter)"
```

---

## Task 11: Build and lint verification

- [ ] **Step 1: Run the full test suite**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox
npx vitest run
```

Expected: all existing tests pass. The new `stripHtmlToText` tests pass too.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no errors or warnings added by this change. Fix any that appear.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: build completes successfully with no type errors. Fix any build errors before proceeding.

- [ ] **Step 5: Commit build fix (if needed)**

```bash
git add -A
git commit -m "fix: resolve build/lint issues from UX redesign"
```

---

## Task 12: Update documentation and open PR

- [ ] **Step 1: Add `.superpowers/` to `.gitignore` if not already present**

```bash
grep -q '\.superpowers' /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox/.gitignore || echo '.superpowers/' >> /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox/.gitignore
git add .gitignore
git commit -m "chore: ignore .superpowers brainstorm directory"
```

- [ ] **Step 2: Verify the plan file is committed**

```bash
git log --oneline -5
```

The spec and plan files should appear in recent commits.

- [ ] **Step 3: Push the branch**

```bash
git push origin main
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create \
  --title "feat: AI-first inbox UX redesign (left rail + split pane)" \
  --body "$(cat <<'EOF'
## Summary

- Adds desktop app shell: 56px icon rail + 280px email list column + main content pane
- Replaces CommandCenterPanel with a full HomeCommandCenter (dark gradient header, 'Handle first' action list, collapsed follow-ups/ignored)
- Conversation page gains the desktop shell; thread and reply composer flow as one continuous section
- Email list snippets use `stripHtmlToText` — never shows raw HTML/CSS
- `HandleThisPanel` renamed to 'Why this matters'; personal-account language fixed throughout
- `/digest` redirects to `/inbox` (Home is now the command center)
- Mobile (< lg) keeps existing full-page behavior unchanged

## Test plan

- [ ] Desktop (≥ 1024px): rail visible, list column visible, home command center in main pane
- [ ] Click a conversation: thread opens in main pane, URL changes to `/conversations/[id]`, list column stays visible with row highlighted
- [ ] Home command center shows 'Handle first' list with reasons and CTAs
- [ ] Follow-ups queued and safely ignored sections appear (collapsed)
- [ ] Email list snippets are plain text (no `<style>`, `<div>`, etc.)
- [ ] 'No reply needed' rows are visually muted
- [ ] Conversation page: reply composer flows below messages with no card gap
- [ ] 'Why this matters' sidebar card visible; Relationship and Work items collapsed
- [ ] Personal accounts: no lead scores, no 'Add business profile' warnings, button says 'Suggest reply'
- [ ] Business accounts: SalesPanel, SupportPanel, CalendarHoldPanel still visible
- [ ] `/digest` redirects to `/inbox`
- [ ] Mobile (< 1024px): existing tab nav and full-page layouts work unchanged
- [ ] `npm run build` and `npm run lint` pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec Coverage Checklist

| Spec section | Tasks covering it |
|---|---|
| App shell (rail + list column) | 2, 3, 5, 7 |
| Home command center | 4, 5 |
| /digest redirect | 6 |
| Email snippet sanitization | 1, 3, 5 |
| FYI row muting | 3 |
| Draft ready indicator | 3 |
| Conversation thread + composer flow | 7 |
| Sidebar "Why this matters" | 8 |
| Relationship/Work items collapsed | 7 |
| Personal account language | 8, 9 |
| Business panels preserved | 7 |
| Mobile unchanged | 5, 7 |
| Build/lint/test verification | 11 |
| Documentation + PR | 12 |
