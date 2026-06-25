# Inbox UX Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing 7-option attention-category tag manager with a clean 5-state workflow status model, fix dashboard count/content mismatches, and keep AI classification as secondary read-only context.

**Architecture:** `Conversation.userState` (already in schema, unused) becomes the canonical user-facing workflow status (`needs_reply | draft_ready | waiting_on | read_later | done`). AI signals stay in `ConversationState.attentionCategory` + `emailType`. A `deriveWorkflowStatus()` helper computes display status from all available fields; a new PATCH `/workflow-status` endpoint writes user choices back. No DB schema migration needed.

**Tech Stack:** Next.js 14 App Router, Prisma (PostgreSQL), TypeScript, Tailwind CSS, Vitest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `lib/workflow-status.ts` | **CREATE** | `deriveWorkflowStatus()`, `aiCategoryLabel()`, `WORKFLOW_STATUS_LABELS` |
| `tests/workflow-status.test.ts` | **CREATE** | Unit tests for derive logic |
| `app/api/conversations/[id]/workflow-status/route.ts` | **CREATE** | PATCH endpoint writing `userState` |
| `app/conversations/[id]/WorkflowStatusSelect.tsx` | **CREATE** | 5-option status select; replaces AttentionCorrectionSelect |
| `app/components/badges.tsx` | **MODIFY** | Add 5 workflow status configs |
| `app/components/ClientFilteredInboxList.tsx` | **MODIFY** | Add `workflowStatus` to `InboxListItem` type |
| `app/components/InboxRowWithSnooze.tsx` | **MODIFY** | Thread `workflowStatus` prop |
| `app/components/InboxRow.tsx` | **MODIFY** | Use `workflowStatus`; update hover dropdown to 4 workflow options |
| `app/components/AppListColumn.tsx` | **MODIFY** | Add `userState` to `ConvRow`; use `deriveWorkflowStatus()`; update filter labels |
| `app/inbox/page.tsx` | **MODIFY** | Update mobile `StatusBadge` to use `deriveWorkflowStatus()` |
| `app/conversations/[id]/page.tsx` | **MODIFY** | Swap `AttentionCorrectionSelect` → `WorkflowStatusSelect` |
| `app/components/HomeCommandCenter.tsx` | **MODIFY** | Fix Handle First count pill: use `topActions.length` |
| `app/components/ReadLaterSection.tsx` | **MODIFY** | Dismiss calls `/workflow-status` with `done` |
| `app/components/NeedsActionSection.tsx` | **MODIFY** | Dismiss calls `/workflow-status` with `done` |
| `app/conversations/[id]/AttentionCorrectionSelect.tsx` | **DELETE** | Replaced by WorkflowStatusSelect |
| `docs/CURRENT_STATE.md` | **MODIFY** | Update UX model description |

---

## Task 1: Core derive logic (`lib/workflow-status.ts`)

**Files:**
- Create: `lib/workflow-status.ts`
- Create: `tests/workflow-status.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/workflow-status.test.ts
import { describe, it, expect } from "vitest"
import { deriveWorkflowStatus, aiCategoryLabel } from "@/lib/workflow-status"

describe("deriveWorkflowStatus", () => {
  it("returns draft_ready when draft is proposed, regardless of other signals", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "done", draftStatus: "proposed" })).toBe("draft_ready")
  })
  it("respects userState=waiting_on", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "waiting_on" })).toBe("waiting_on")
  })
  it("respects userState=read_later", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "read_later" })).toBe("read_later")
  })
  it("respects userState=done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "done" })).toBe("done")
  })
  it("falls through to derive when userState=needs_reply (reset)", () => {
    expect(deriveWorkflowStatus({ status: "closed", userState: "needs_reply" })).toBe("done")
  })
  it("attentionCategory=waiting_on → waiting_on", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, attentionCategory: "waiting_on" })).toBe("waiting_on")
  })
  it("attentionCategory=read_later → read_later", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, attentionCategory: "read_later" })).toBe("read_later")
  })
  it("attentionCategory=fyi_done → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, attentionCategory: "fyi_done" })).toBe("done")
  })
  it("attentionCategory=quiet → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, attentionCategory: "quiet" })).toBe("done")
  })
  it("status=closed → done", () => {
    expect(deriveWorkflowStatus({ status: "closed", userState: null })).toBe("done")
  })
  it("status=in_progress → waiting_on", () => {
    expect(deriveWorkflowStatus({ status: "in_progress", userState: null })).toBe("waiting_on")
  })
  it("emailType=newsletter → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, emailType: "newsletter" })).toBe("done")
  })
  it("emailType=notification → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, emailType: "notification" })).toBe("done")
  })
  it("emailType=marketing → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, emailType: "marketing" })).toBe("done")
  })
  it("defaults to needs_reply", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null })).toBe("needs_reply")
  })
})

describe("aiCategoryLabel", () => {
  it("returns label for attentionCategory", () => {
    expect(aiCategoryLabel("needs_action", null)).toBe("Needs Action")
  })
  it("returns label for emailType", () => {
    expect(aiCategoryLabel(null, "newsletter")).toBe("Newsletter")
  })
  it("attentionCategory takes precedence over emailType", () => {
    expect(aiCategoryLabel("review_soon", "newsletter")).toBe("Review Soon")
  })
  it("returns null when neither is recognized", () => {
    expect(aiCategoryLabel(null, null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox
npx vitest run tests/workflow-status.test.ts
```
Expected: errors about missing module `@/lib/workflow-status`

- [ ] **Step 3: Implement `lib/workflow-status.ts`**

```typescript
// lib/workflow-status.ts
export type WorkflowStatus =
  | "needs_reply"
  | "draft_ready"
  | "waiting_on"
  | "read_later"
  | "done"

export interface DeriveWorkflowStatusInput {
  status: string
  userState?: string | null
  draftStatus?: string | null
  attentionCategory?: string | null
  emailType?: string | null
}

const FYI_ATTENTION = new Set(["fyi_done", "quiet"])
const FYI_EMAIL_TYPES = new Set(["notification", "newsletter", "marketing"])

export function deriveWorkflowStatus(input: DeriveWorkflowStatusInput): WorkflowStatus {
  // draft_ready is always derived from draft state — cannot be overridden by userState
  if (input.draftStatus === "proposed") return "draft_ready"

  // Explicit user choice wins (except needs_reply which means "reset to derive")
  const u = input.userState
  if (u === "waiting_on" || u === "read_later" || u === "done") return u

  // AI attention category signals
  if (input.attentionCategory === "waiting_on") return "waiting_on"
  if (input.attentionCategory === "read_later") return "read_later"
  if (FYI_ATTENTION.has(input.attentionCategory ?? "")) return "done"

  // Conversation DB status
  if (input.status === "closed") return "done"
  if (input.status === "in_progress") return "waiting_on"

  // Auto-email types
  if (FYI_EMAIL_TYPES.has(input.emailType ?? "")) return "done"

  return "needs_reply"
}

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  needs_reply: "Needs Reply",
  draft_ready: "Draft Ready",
  waiting_on: "Waiting On",
  read_later: "Read Later",
  done: "Done",
}

const AI_CATEGORY_LABELS: Record<string, string> = {
  newsletter: "Newsletter",
  notification: "Notification",
  marketing: "Marketing",
  receipt: "Receipt / Billing",
  billing: "Receipt / Billing",
  security: "Security",
  personal: "Personal",
  job_alert: "Job Alert",
  needs_action: "Needs Action",
  review_soon: "Review Soon",
}

export function aiCategoryLabel(
  attentionCategory: string | null | undefined,
  emailType: string | null | undefined,
): string | null {
  if (attentionCategory && AI_CATEGORY_LABELS[attentionCategory]) {
    return AI_CATEGORY_LABELS[attentionCategory]
  }
  if (emailType && AI_CATEGORY_LABELS[emailType]) {
    return AI_CATEGORY_LABELS[emailType]
  }
  return null
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/workflow-status.test.ts
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/workflow-status.ts tests/workflow-status.test.ts
git commit -m "feat: add deriveWorkflowStatus helper and aiCategoryLabel"
```

---

## Task 2: API endpoint for writing workflow status

**Files:**
- Create: `app/api/conversations/[id]/workflow-status/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// app/api/conversations/[id]/workflow-status/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const SETTABLE_STATUSES = new Set(["needs_reply", "waiting_on", "read_later", "done"])

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { workflowStatus?: string }
  const { workflowStatus } = body

  if (!workflowStatus || !SETTABLE_STATUSES.has(workflowStatus)) {
    return NextResponse.json({ error: "Invalid workflowStatus" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true },
  })
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const now = new Date()
  const data: {
    userState: string | null
    userStateSource: string
    userStateUpdatedAt: Date
    status?: string
  } = {
    // "needs_reply" means "reset": clear userState so derive logic takes over
    userState: workflowStatus === "needs_reply" ? null : workflowStatus,
    userStateSource: "user",
    userStateUpdatedAt: now,
  }

  // Keep conversation.status in sync for backward compat with existing queries
  if (workflowStatus === "done") {
    data.status = "closed"
  } else if (workflowStatus === "needs_reply") {
    data.status = "needs_reply"
  }

  await prisma.conversation.update({
    where: { id: params.id },
    data,
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Verify the route file was created and typecheck passes**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors in the new file (there may be pre-existing errors in other files)

- [ ] **Step 3: Commit**

```bash
git add app/api/conversations/[id]/workflow-status/route.ts
git commit -m "feat: add PATCH /workflow-status endpoint writing userState"
```

---

## Task 3: WorkflowStatusSelect component

**Files:**
- Create: `app/conversations/[id]/WorkflowStatusSelect.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/conversations/[id]/WorkflowStatusSelect.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  deriveWorkflowStatus,
  aiCategoryLabel,
  type WorkflowStatus,
} from "@/lib/workflow-status"

const SETTABLE_OPTIONS: { value: WorkflowStatus; label: string }[] = [
  { value: "needs_reply", label: "Needs Reply" },
  { value: "waiting_on", label: "Waiting On" },
  { value: "read_later", label: "Read Later" },
  { value: "done", label: "Done" },
]

interface Props {
  conversationId: string
  status: string
  userState?: string | null
  draftStatus?: string | null
  attentionCategory?: string | null
  emailType?: string | null
}

export default function WorkflowStatusSelect({
  conversationId,
  status,
  userState,
  draftStatus,
  attentionCategory,
  emailType,
}: Props) {
  const router = useRouter()
  const derived = deriveWorkflowStatus({ status, userState, draftStatus, attentionCategory, emailType })
  // draft_ready is AI-driven — show the info pill but select "needs_reply" in the dropdown
  const [selected, setSelected] = useState<WorkflowStatus>(
    derived === "draft_ready" ? "needs_reply" : derived
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = deriveWorkflowStatus({ status, userState, draftStatus, attentionCategory, emailType })
    setSelected(d === "draft_ready" ? "needs_reply" : d)
  }, [status, userState, draftStatus, attentionCategory, emailType])

  const categoryLabel = aiCategoryLabel(attentionCategory, emailType)

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as WorkflowStatus
    if (next === selected) return
    const prev = selected
    setSelected(next)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: next }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setSelected(prev)
        setError("Failed to update")
      }
    } catch {
      setSelected(prev)
      setError("Failed to update")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2">
      <label className="text-xs text-slate-500">Status</label>
      {derived === "draft_ready" && (
        <p className="mt-0.5 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
          Draft Ready — review before sending
        </p>
      )}
      <select
        value={selected}
        onChange={handleChange}
        disabled={saving}
        className="mt-0.5 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
      >
        {SETTABLE_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      {categoryLabel && (
        <p className="mt-1 text-[10px] text-slate-400">AI category: {categoryLabel}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -i "WorkflowStatusSelect"
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/conversations/[id]/WorkflowStatusSelect.tsx
git commit -m "feat: add WorkflowStatusSelect component"
```

---

## Task 4: Update badges

**Files:**
- Modify: `app/components/badges.tsx`

- [ ] **Step 1: Read current file**

File is at `app/components/badges.tsx` — already read, current content:
```typescript
export function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    needs_reply: { label: "Needs Reply", className: "bg-red-100 text-red-700" },
    in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-700" },
    closed: { label: "Closed", className: "bg-slate-100 text-slate-500" },
  };
  ...
```

- [ ] **Step 2: Replace the config in StatusBadge**

Replace the entire `StatusBadge` function in `app/components/badges.tsx`:

```typescript
export function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    needs_reply: { label: "Needs Reply", className: "bg-red-100 text-red-700" },
    draft_ready: { label: "Draft Ready", className: "bg-blue-100 text-blue-700" },
    waiting_on:  { label: "Waiting On",  className: "bg-indigo-100 text-indigo-700" },
    read_later:  { label: "Read Later",  className: "bg-violet-100 text-violet-700" },
    done:        { label: "Done",        className: "bg-slate-100 text-slate-500" },
    // Legacy DB values — map to display equivalents so old StatusBadge callsites keep working
    in_progress: { label: "Waiting On",  className: "bg-indigo-100 text-indigo-700" },
    closed:      { label: "Done",        className: "bg-slate-100 text-slate-500" },
  }
  const c = config[status] ?? config.needs_reply
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.className}`}
    >
      {c.label}
    </span>
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep badges
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/components/badges.tsx
git commit -m "feat: update StatusBadge for 5 workflow statuses"
```

---

## Task 5: Left rail — AppListColumn, InboxRow chain

**Files:**
- Modify: `app/components/AppListColumn.tsx`
- Modify: `app/components/ClientFilteredInboxList.tsx`
- Modify: `app/components/InboxRowWithSnooze.tsx`
- Modify: `app/components/InboxRow.tsx`

### 5a: Add `workflowStatus` to `InboxListItem`

Open `app/components/ClientFilteredInboxList.tsx`. Add `workflowStatus: import("@/lib/workflow-status").WorkflowStatus` to the `InboxListItem` type and thread it to `InboxRowWithSnooze`:

- [ ] **Step 1: Update `InboxListItem` type and pass `workflowStatus` to row**

Replace the `InboxListItem` type:
```typescript
// app/components/ClientFilteredInboxList.tsx
import type { WorkflowStatus } from "@/lib/workflow-status"

export type InboxListItem = {
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
  initialStatus: string
  workflowStatus: WorkflowStatus
  attentionCategory: string | null
  isPersonal: boolean
  isGmail: boolean
  isVip?: boolean
  vipLabel?: string | null
  snoozeUntil?: string | null
  searchText: string
}
```

In the JSX, add `workflowStatus={item.workflowStatus}` to the `<InboxRowWithSnooze>` call (alongside the existing props).

### 5b: Thread `workflowStatus` through `InboxRowWithSnooze`

- [ ] **Step 2: Add prop to InboxRowWithSnooze**

Replace the type in `app/components/InboxRowWithSnooze.tsx`:
```typescript
import type { WorkflowStatus } from "@/lib/workflow-status"

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
  initialStatus: string
  workflowStatus: WorkflowStatus
  attentionCategory: string | null
  isPersonal: boolean
  isGmail: boolean
  isVip?: boolean
  vipLabel?: string | null
  snoozeUntil?: string | null
}
```
The `{...props}` spread already passes it through to `InboxRow` — no other change needed in `InboxRowWithSnooze.tsx`.

### 5c: Update InboxRow

- [ ] **Step 3: Update InboxRow to use workflowStatus**

Replace the `ATTENTION_OPTIONS` constant and `InboxRowProps` type, and update the `changeAttention` / toggle logic in `app/components/InboxRow.tsx`:

At the top, add import:
```typescript
import type { WorkflowStatus } from "@/lib/workflow-status"
```

Replace `ATTENTION_OPTIONS`:
```typescript
const WORKFLOW_OPTIONS: { value: string; label: string; dot: string }[] = [
  { value: "needs_reply", label: "Needs Reply", dot: "bg-red-500" },
  { value: "waiting_on",  label: "Waiting On",  dot: "bg-indigo-400" },
  { value: "read_later",  label: "Read Later",  dot: "bg-violet-400" },
  { value: "done",        label: "Done",        dot: "bg-emerald-500" },
]
```

Add `workflowStatus: WorkflowStatus` to `InboxRowProps`:
```typescript
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
  initialStatus: string
  workflowStatus: WorkflowStatus
  isVip?: boolean
  vipLabel?: string | null
  onSnooze?: () => void
  snoozeUntil?: string | null
  attentionCategory: string | null
  isPersonal: boolean
  isGmail: boolean
}
```

In the function body, add the prop and update the derived state:
```typescript
export default function InboxRow({
  id,
  href,
  isSelected,
  isFyi,
  isUnread: initialIsUnread,
  name,
  snippet,
  timeLabel,
  statusDot,
  statusText,
  statusLabel,
  hasDraft,
  initialStatus,
  workflowStatus: initialWorkflowStatus,
  isVip,
  vipLabel,
  onSnooze,
  snoozeUntil,
  attentionCategory: initialAttention,
  isPersonal,
  isGmail,
}: InboxRowProps) {
  const router = useRouter()
  const [isRead, setIsRead] = useState(!initialIsUnread)
  const [status, setStatus] = useState(initialStatus)
  const [workflowStatus, setWorkflowStatus] = useState(initialWorkflowStatus)
  const [attention, setAttention] = useState(initialAttention)
  const [showAttention, setShowAtt] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null)
  const attentionBtnRef = useRef<HTMLButtonElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)

  const [archiveError, setArchiveError] = useState<string | null>(null)
  const isUnread = !isRead
  const isClosed = workflowStatus === "done"
```

Replace `toggleStatus` to use the new endpoint:
```typescript
  async function toggleStatus(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const nextStatus = isClosed ? "needs_reply" : "done"
    setWorkflowStatus(nextStatus as WorkflowStatus)
    const res = await fetch(`/api/conversations/${id}/workflow-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowStatus: nextStatus }),
    })
    if (!res.ok) setWorkflowStatus(workflowStatus)
    else router.refresh()
  }
```

Replace `changeAttention` to use the new endpoint:
```typescript
  async function changeAttention(e: React.MouseEvent, cat: string) {
    e.preventDefault()
    e.stopPropagation()
    setShowAtt(false)
    const prev = attention
    setAttention(cat)
    setWorkflowStatus(cat as WorkflowStatus)
    const res = await fetch(`/api/conversations/${id}/workflow-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowStatus: cat }),
    })
    if (!res.ok) { setAttention(prev); setWorkflowStatus(initialWorkflowStatus) }
    else router.refresh()
  }
```

Update text dimming (two places in the JSX) — replace `isFyi || isClosed` with `workflowStatus === "done"`:
```typescript
// name text className:
isUnread
  ? "font-bold text-slate-900"
  : workflowStatus === "done"
    ? "font-normal text-slate-500"
    : "font-semibold text-slate-800"

// snippet text className:
isUnread ? "text-slate-600" : workflowStatus === "done" ? "text-slate-400" : "text-slate-500"
```

Update draft badge:
```typescript
{hasDraft && workflowStatus !== "done" && (
  <span className="text-[10px] font-semibold text-blue-600">✦ draft</span>
)}
```

Replace `ATTENTION_OPTIONS` reference in the portal dropdown:
```typescript
{WORKFLOW_OPTIONS.map((opt) => (
  <button
    key={opt.value}
    type="button"
    onClick={(e) => changeAttention(e, opt.value)}
    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-slate-50 focus:outline-none ${
      attention === opt.value ? "font-semibold text-slate-900" : "text-slate-700"
    }`}
  >
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${opt.dot}`} />
    {opt.label}
  </button>
))}
```

### 5d: Update AppListColumn

- [ ] **Step 4: Update AppListColumn to use deriveWorkflowStatus**

In `app/components/AppListColumn.tsx`:

Add import at top:
```typescript
import { deriveWorkflowStatus, type WorkflowStatus } from "@/lib/workflow-status"
```

Add `userState: string | null` to `ConvRow` type:
```typescript
type ConvRow = {
  id: string
  status: string
  userState: string | null
  lastMessageAt: Date
  externalThreadId: string
  readAt: Date | null
  gmailUnread: boolean | null
  contact: { name: string; phoneE164: string | null } | null
  messages: { body: string; subject: string | null; direction: string }[]
  draft: { status: string } | null
  stateRecord: {
    state: string
    metadataJson: unknown
    attentionCategory: string | null
    emailType: string | null
  } | null
  channel: { provider: string }
}
```

Replace `STATUS_FILTERS` to use new labels:
```typescript
const STATUS_FILTERS = [
  { label: "All",         value: null },
  { label: "Needs Reply", value: "needs_reply" },
  { label: "Waiting",     value: "in_progress" },
  { label: "Done",        value: "closed" },
]
```

Add workflow status style map (keep alongside or replace `STATUS_STYLE` + `ATTENTION_STYLE`):
```typescript
const WORKFLOW_STATUS_STYLE: Record<WorkflowStatus, { dot: string; text: string }> = {
  needs_reply: { dot: "bg-red-500",     text: "text-red-700" },
  draft_ready: { dot: "bg-blue-500",    text: "text-blue-700" },
  waiting_on:  { dot: "bg-indigo-400",  text: "text-indigo-700" },
  read_later:  { dot: "bg-violet-400",  text: "text-violet-700" },
  done:        { dot: "bg-emerald-500", text: "text-emerald-700" },
}

const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  needs_reply: "Needs Reply",
  draft_ready: "Draft Ready",
  waiting_on:  "Waiting On",
  read_later:  "Read Later",
  done:        "Done",
}
```

In the `listItems` mapping, compute workflow status and use it:
```typescript
const listItems: InboxListItem[] = displayConversations.map((conv) => {
  const attnCat = attentionCategory(conv)
  const workflowStatus = deriveWorkflowStatus({
    status: conv.status,
    userState: conv.userState,
    draftStatus: conv.draft?.status,
    attentionCategory: attnCat,
    emailType: conv.stateRecord?.emailType,
  })
  const style = WORKFLOW_STATUS_STYLE[workflowStatus]
  const name = conv.contact?.name ?? conv.externalThreadId
  const msg0 = conv.messages[0]
  const bodySnippet = msg0?.body ? stripHtmlToText(msg0.body, 75) : ""
  const snippet = buildPreviewText(msg0?.subject, bodySnippet)
  const hasDraft = conv.draft?.status === "proposed" || conv.draft?.status === "approved"
  const meta = conv.stateRecord?.metadataJson as Record<string, unknown> | null ?? {}
  const isVip = meta?.isVip === true
  const vipLabel = typeof meta?.vipLabel === "string" ? meta.vipLabel : null
  const snoozeUntil = typeof meta?.snoozeUntil === "string" ? meta.snoozeUntil : null

  return {
    id: conv.id,
    href: buildConversationHref(conv.id, returnTo),
    isSelected: conv.id === activeConversationId,
    isUnread: !conv.readAt && conv.gmailUnread !== false,
    isFyi: workflowStatus === "done",
    isClosed: workflowStatus === "done",
    name,
    snippet,
    timeLabel: relativeTime(conv.lastMessageAt),
    statusDot: style.dot,
    statusText: style.text,
    statusLabel: WORKFLOW_STATUS_LABEL[workflowStatus],
    hasDraft,
    initialStatus: conv.status,
    workflowStatus,
    attentionCategory: attnCat,
    isPersonal,
    isGmail: conv.channel.provider === "google",
    isVip,
    vipLabel,
    snoozeUntil,
    searchText: `${name} ${conv.externalThreadId} ${snippet}`.toLowerCase(),
  }
})
```

Update `displayConversations` filter to use `deriveWorkflowStatus`:
```typescript
const displayConversations =
  status === "needs_reply"
    ? conversations.filter((conv) => deriveWorkflowStatus({
        status: conv.status,
        userState: conv.userState,
        draftStatus: conv.draft?.status,
        attentionCategory: attentionCategory(conv),
        emailType: conv.stateRecord?.emailType,
      }) !== "done")
    : conversations
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "(AppListColumn|InboxRow|InboxRowWithSnooze|ClientFiltered)" | head -20
```
Expected: no errors in these files

- [ ] **Step 6: Commit**

```bash
git add app/components/AppListColumn.tsx app/components/ClientFilteredInboxList.tsx \
        app/components/InboxRowWithSnooze.tsx app/components/InboxRow.tsx
git commit -m "feat: left rail uses deriveWorkflowStatus; update hover dropdown to workflow options"
```

---

## Task 6: Update mobile inbox page status badge

**Files:**
- Modify: `app/inbox/page.tsx`

- [ ] **Step 1: Add import and update StatusBadge usage**

At the top of `app/inbox/page.tsx`, add:
```typescript
import { deriveWorkflowStatus } from "@/lib/workflow-status"
```

Find the `<StatusBadge>` usage in the mobile conversation list (around line 644):
```typescript
<StatusBadge status={isFyiConversation(conversation) ? "closed" : conversation.status} />
```

Replace with:
```typescript
<StatusBadge status={deriveWorkflowStatus({
  status: conversation.status,
  userState: conversation.userState,
  draftStatus: null,
  attentionCategory: conversation.stateRecord?.attentionCategory ?? null,
  emailType: conversation.stateRecord?.emailType ?? null,
})} />
```

Note: `conversation.userState` is a scalar field on `Conversation` — Prisma includes all scalars by default when using `include`, so it's already in the query result. TypeScript may show a type error if the inferred Prisma type doesn't surface it in the narrowed type used in the map. If so, cast: `(conversation as typeof conversation & { userState: string | null }).userState`.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "inbox/page"
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/inbox/page.tsx
git commit -m "feat: mobile inbox status badge uses deriveWorkflowStatus"
```

---

## Task 7: Swap AttentionCorrectionSelect → WorkflowStatusSelect in conversation detail

**Files:**
- Modify: `app/conversations/[id]/page.tsx`
- Delete: `app/conversations/[id]/AttentionCorrectionSelect.tsx`

- [ ] **Step 1: Update the conversation detail page**

In `app/conversations/[id]/page.tsx`:

Replace the import:
```typescript
// Remove:
import AttentionCorrectionSelect from "@/app/conversations/[id]/AttentionCorrectionSelect";
// Add:
import WorkflowStatusSelect from "@/app/conversations/[id]/WorkflowStatusSelect";
```

Find the `contactCard` block that contains `<AttentionCorrectionSelect>` (around line 420):
```typescript
<div className="mt-3 border-t border-slate-100 pt-3">
  <AttentionCorrectionSelect
    conversationId={conversation.id}
    current={attentionCategory ?? undefined}
  />
</div>
```

Replace with:
```typescript
<div className="mt-3 border-t border-slate-100 pt-3">
  <WorkflowStatusSelect
    conversationId={conversation.id}
    status={conversation.status}
    userState={conversation.userState}
    draftStatus={conversation.draft?.status ?? null}
    attentionCategory={attentionCategory}
    emailType={emailType}
  />
</div>
```

- [ ] **Step 2: Delete `AttentionCorrectionSelect.tsx`**

```bash
rm app/conversations/[id]/AttentionCorrectionSelect.tsx
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "(AttentionCorrection|WorkflowStatus|conversations/\[id\]/page)" | head -20
```
Expected: no references to AttentionCorrectionSelect; no errors in WorkflowStatusSelect

- [ ] **Step 4: Commit**

```bash
git add app/conversations/[id]/page.tsx
git rm app/conversations/[id]/AttentionCorrectionSelect.tsx
git commit -m "feat: replace AttentionCorrectionSelect with WorkflowStatusSelect in conversation detail"
```

---

## Task 8: Fix Handle First count pill mismatch

**Files:**
- Modify: `app/components/HomeCommandCenter.tsx`

The bug: `statPills` uses `counts.needsReply` for the red pill, but Handle First shows `topActions` (which can include items beyond `needsReply`). Fix: use `topActions.length` so the count always matches what's shown.

- [ ] **Step 1: Update stat pills in HomeCommandCenter**

In `app/components/HomeCommandCenter.tsx`, change:

```typescript
// Before:
const statPills = [
  { label: "Needs Reply", value: counts.needsReply, accent: "red" as const },
  { label: "Needs Action", value: counts.needsAction, accent: "amber" as const },
  { label: "Waiting On", value: counts.waitingOnThem, accent: "blue" as const },
  { label: "Read Later", value: counts.readLater, accent: "neutral" as const },
  { label: "Quietly Handled", value: counts.safelyIgnored, accent: "dim" as const },
]
```

to:

```typescript
// After:
const statPills = [
  { label: "Handle First", value: topActions.length, accent: "red" as const },
  { label: "Waiting On", value: counts.waitingOnThem, accent: "blue" as const },
  { label: "Read Later", value: counts.readLater, accent: "neutral" as const },
  { label: "Quietly Handled", value: counts.safelyIgnored, accent: "dim" as const },
]
```

Note: `topActions` is already destructured from `commandCenter` at the top of the component: `const { counts, topActions, sections, quietlyHandledBreakdown } = commandCenter`.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "HomeCommandCenter"
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/components/HomeCommandCenter.tsx
git commit -m "fix: Handle First count pill uses topActions.length to match items shown"
```

---

## Task 9: Fix dismiss actions in ReadLater and NeedsAction sections

**Files:**
- Modify: `app/components/ReadLaterSection.tsx`
- Modify: `app/components/NeedsActionSection.tsx`

Currently these sections call `PATCH /attention` with `attentionCategory: "fyi_done"` when dismissed. This conflates "I dismissed this" with an internal AI category. Update to call `PATCH /workflow-status` with `workflowStatus: "done"`.

### 9a: ReadLaterSection

- [ ] **Step 1: Update dismiss in ReadLaterSection**

In `app/components/ReadLaterSection.tsx`, find `handleDismiss`:
```typescript
async function handleDismiss(e: React.MouseEvent, attentionCategory: string) {
  ...
  const res = await fetch(`/api/conversations/${item.id}/attention`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attentionCategory }),
  })
  ...
}
```

Replace the function and update both dismiss button calls:
```typescript
async function handleDismiss(e: React.MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  setDismissed(true)
  setError(null)
  const res = await fetch(`/api/conversations/${item.id}/workflow-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowStatus: "done" }),
  })
  if (!res.ok) {
    setDismissed(false)
    setError("Couldn't update")
  } else {
    router.refresh()
  }
}
```

Update both dismiss buttons to call `handleDismiss` without extra args:
```typescript
// Checkmark "done" button:
onClick={(e) => handleDismiss(e)}
title="Mark as done"
aria-label="Mark as done"

// X "quiet" button — also marks done now (both are "done" to user):
onClick={(e) => handleDismiss(e)}
title="Mark as done"
aria-label="Mark as done"
```

### 9b: NeedsActionSection

- [ ] **Step 2: Update dismiss in NeedsActionSection**

In `app/components/NeedsActionSection.tsx`, find `dismissAction`:
```typescript
async function dismissAction(event: React.MouseEvent<HTMLButtonElement>) {
  ...
  const res = await fetch(`/api/conversations/${item.id}/attention`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attentionCategory: "fyi_done" }),
  })
  ...
}
```

Replace the fetch call:
```typescript
const res = await fetch(`/api/conversations/${item.id}/workflow-status`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ workflowStatus: "done" }),
})
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "(ReadLater|NeedsAction)" | head -10
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/components/ReadLaterSection.tsx app/components/NeedsActionSection.tsx
git commit -m "fix: ReadLater and NeedsAction dismiss calls workflow-status API instead of attention"
```

---

## Task 10: Update docs

**Files:**
- Modify: `docs/CURRENT_STATE.md`

- [ ] **Step 1: Update the inbox intelligence section**

Find the paragraph in `docs/CURRENT_STATE.md` that starts:
```
- Attention categories (`needs_reply`, `needs_action`, `review_soon`, `read_later`, `waiting_on`, `fyi_done`, `quiet`), manual corrections, and learned sender/domain rules.
```

Replace it with:
```
- **User-facing workflow status** (`Conversation.userState`): five clean states — Needs Reply, Draft Ready, Waiting On, Read Later, Done. `userState` is the canonical user choice; when null, `deriveWorkflowStatus()` computes it from DB status + AI attention category + draft state. AI signals (`attentionCategory`, `emailType`) remain in `ConversationState` as secondary read-only context, not primary user controls.
- Manual corrections via `WorkflowStatusSelect` in the conversation right rail; learned sender/domain rules.
```

Also update the date at the top: `Last updated: 2026-06-25 (inbox-ux-simplification)`

- [ ] **Step 2: Commit**

```bash
git add docs/CURRENT_STATE.md
git commit -m "docs: update CURRENT_STATE for inbox UX simplification"
```

---

## Task 11: Full typecheck, build, and push

- [ ] **Step 1: Full typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -40
```
Expected: zero errors in project files (pre-existing errors in node_modules are fine to ignore)

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -20
```
Expected: successful build with no new errors

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```
Expected: all tests pass (no regressions)

- [ ] **Step 4: Push to GitHub**

```bash
git push origin main
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Right rail shows WorkflowStatusSelect with 5 options — Task 3, 7
- [x] AI category shown as read-only secondary chip — Task 3 (`categoryLabel`)
- [x] Left rail labels updated — Task 5 (AppListColumn + InboxRow)
- [x] Dashboard Handle First count matches items shown — Task 8
- [x] Dashboard sections use consistent language — Task 8 (stat pills)
- [x] Dismiss in ReadLater/NeedsAction writes `done` not `fyi_done` — Task 9
- [x] No giant confusing dropdown — Task 7 (AttentionCorrectionSelect deleted)
- [x] Read/unread stays separate — not changed
- [x] Refreshing preserves state — `userState` is persisted in DB
- [x] typecheck/lint/build — Task 11
- [x] Push to GitHub — Task 11

**Placeholder scan:** No TBD, TODO, or vague steps. All code blocks are complete.

**Type consistency:**
- `WorkflowStatus` imported from `@/lib/workflow-status` in all tasks — consistent
- `deriveWorkflowStatus` called with `DeriveWorkflowStatusInput` shape in Tasks 5, 6 — consistent
- `workflowStatus` prop flows `AppListColumn → InboxListItem → InboxRowWithSnooze → InboxRow` — consistent
- PATCH body key is `workflowStatus` in both route.ts (Task 2) and all callers (Tasks 3, 5, 9) — consistent
