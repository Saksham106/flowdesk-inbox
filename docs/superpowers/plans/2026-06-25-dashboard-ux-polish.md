# Dashboard UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the FlowDesk dashboard feel magical and action-oriented — labeled buttons everywhere, inline undo, working dismissals, snooze for Handle First, and human-readable Agent Activity.

**Architecture:** Pure client-side polish pass: no new API routes, no new server components, no new files. Each component manages its own optimistic state and undo timer. Inline undo pattern: card shows "Marked as done · Undo" for 5 seconds, then removes itself. All snooze/status/dismiss calls already exist at `/api/conversations/[id]/workflow-status` and `/api/conversations/[id]/snooze`.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript strict, Tailwind CSS, Vitest

---

## Files Changed

| File | Change |
|---|---|
| `app/components/HandleFirstSection.tsx` | Add Snooze popover (3 presets), Waiting On button, inline Done+undo, rename "Mark Done"→"Done" |
| `app/components/NeedsActionSection.tsx` | Rename "Not needed"→"Handled", "Saving..."→"Saving…" |
| `app/components/BillsDeadlinesList.tsx` | Fix conversation dismiss endpoint, add "Not relevant" labeled button |
| `app/components/ReadLaterSection.tsx` | Replace icon buttons with "Done"/"Not interested" text labels, inline undo, fix "+N more" link |
| `app/components/QuietlyHandledBanner.tsx` | Fix link to `/inbox?status=closed`, "emails sorted quietly" |
| `app/components/AgentActivitySection.tsx` | Add `quietlyHandledBreakdown` prop, breakdown-level activity lines |
| `app/components/HomeCommandCenter.tsx` | Pass `quietlyHandledBreakdown` to `AgentActivitySection` |
| `tests/needs-action-section.test.ts` | Update assertion from "Not needed" to "Handled" |

---

### Task 1: HandleFirstSection — Snooze, Waiting On, inline Done+undo

**Files:**
- Modify: `app/components/HandleFirstSection.tsx`

- [ ] **Step 1: Write the test**

Create `tests/handle-first-section.test.ts`:

```typescript
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("HandleFirstSection", () => {
  it("has Snooze button and SNOOZE_PRESETS", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/HandleFirstSection.tsx"),
      "utf8"
    )
    expect(source).toContain("SNOOZE_PRESETS")
    expect(source).toContain("Tonight (8 pm)")
    expect(source).toContain("Tomorrow morning")
    expect(source).toContain("Next week")
    expect(source).toContain("/api/conversations/${item.id}/snooze")
  })

  it("has Waiting On button calling workflow-status", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/HandleFirstSection.tsx"),
      "utf8"
    )
    expect(source).toContain("Waiting On")
    expect(source).toContain('workflowStatus: "waiting_on"')
  })

  it("has inline undo after marking done", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/HandleFirstSection.tsx"),
      "utf8"
    )
    expect(source).toContain("undoable")
    expect(source).toContain("undoTimerRef")
    expect(source).toContain('workflowStatus: "needs_reply"')
    expect(source).toContain("Undo")
  })

  it("does not contain Mark Done", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/HandleFirstSection.tsx"),
      "utf8"
    )
    expect(source).not.toContain("Mark Done")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/handle-first-section.test.ts
```

Expected: FAIL (SNOOZE_PRESETS not found, etc.)

- [ ] **Step 3: Implement HandleFirstSection**

Replace the entire file `app/components/HandleFirstSection.tsx` with:

```tsx
"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { CommandCenterConversation, CommandCenterPriority } from "@/lib/agent/command-center"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / 86400000)
  return `${days}d ago`
}

const PRIORITY_STYLES: Partial<Record<CommandCenterPriority, string>> = {
  urgent: "border-l-2 border-l-red-300 bg-red-50/40",
  high: "border-l-2 border-l-amber-300 bg-amber-50/40",
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  otp: "Code detected",
  verification_code: "Code detected",
  password_reset: "Password reset",
  create_password: "Create password",
  email_verification: "Email verification",
  security_alert: "Security alert",
  magic_link: "Login link",
  action_required: "Action required",
}

function actionLabel(type: string): string {
  return ACTION_TYPE_LABELS[type] ?? type.replace(/_/g, " ")
}

function getTonightEightPM(): Date {
  const d = new Date()
  d.setHours(20, 0, 0, 0)
  if (d <= new Date()) d.setDate(d.getDate() + 1)
  return d
}

function getTomorrowMorning(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

function getNextMonday(): Date {
  const d = new Date()
  const day = d.getDay()
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  d.setDate(d.getDate() + daysUntilMonday)
  d.setHours(9, 0, 0, 0)
  return d
}

const SNOOZE_PRESETS = [
  { label: "Tonight (8 pm)", getDate: getTonightEightPM },
  { label: "Tomorrow morning", getDate: getTomorrowMorning },
  { label: "Next week", getDate: getNextMonday },
]

interface CardProps {
  item: CommandCenterConversation
}

function HandleFirstCard({ item }: CardProps) {
  const router = useRouter()
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [doneState, setDoneState] = useState<"idle" | "undoable" | "done">("idle")
  const [doneError, setDoneError] = useState<string | null>(null)
  const [showSnooze, setShowSnooze] = useState(false)
  const [snoozeError, setSnoozeError] = useState<string | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snoozeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!showSnooze) return
    function handleOutsideClick(e: MouseEvent) {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) {
        setShowSnooze(false)
      }
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [showSnooze])

  if (doneState === "done") return null

  if (doneState === "undoable") {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between ${PRIORITY_STYLES[item.priority] ?? ""}`}>
        <span className="text-[11px] text-slate-500">Marked as done</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
            setDoneState("idle")
            fetch(`/api/conversations/${item.id}/workflow-status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ workflowStatus: "needs_reply" }),
            })
          }}
          className="text-[10px] font-semibold text-blue-600 hover:underline"
        >
          Undo
        </button>
      </div>
    )
  }

  async function handleDraftReply() {
    setDraftLoading(true)
    setDraftError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/draft/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? "Draft generation failed")
      }
      router.push(item.href)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to generate draft")
      setDraftLoading(false)
    }
  }

  async function handleDone(e: React.MouseEvent) {
    e.stopPropagation()
    setDoneError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: "done" }),
      })
      if (!res.ok) throw new Error("Failed")
      setDoneState("undoable")
      undoTimerRef.current = setTimeout(() => setDoneState("done"), 5000)
    } catch {
      setDoneError("Couldn't mark as done")
    }
  }

  async function handleWaitingOn(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/conversations/${item.id}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: "waiting_on" }),
      })
      if (!res.ok) throw new Error()
      setDoneState("done")
      router.refresh()
    } catch {
      // silent — secondary action
    }
  }

  async function handleSnooze(e: React.MouseEvent, getDate: () => Date) {
    e.stopPropagation()
    setShowSnooze(false)
    setSnoozeError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snoozeUntil: getDate().toISOString() }),
      })
      if (!res.ok) throw new Error()
      setDoneState("done")
      router.refresh()
    } catch {
      setSnoozeError("Couldn't snooze")
    }
  }

  function openCard() {
    router.push(item.href)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openCard()
    }
  }

  const priorityClass = PRIORITY_STYLES[item.priority] ?? ""
  const readClass = item.isRead ? "" : "ring-1 ring-blue-100"
  const action = item.action

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={handleKeyDown}
      className={`cursor-pointer rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:shadow-sm hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 ${priorityClass} ${readClass}`}
      aria-label={`Open ${item.displayName}`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className={`text-[12px] truncate ${item.isRead ? "font-medium text-slate-700" : "font-semibold text-slate-900"}`}>
          {item.displayName}
        </p>
        <span className="text-[10px] text-slate-400 flex-shrink-0">{relativeTime(item.lastMessageAt)}</span>
      </div>

      <p className="text-[11px] text-slate-600 truncate mb-1">{item.nextAction}</p>
      <p className="text-[10px] text-slate-400 italic mb-2">{item.reason}</p>

      {action && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          {action.hasDetectedCode && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
              Code detected
            </span>
          )}
          {!action.hasDetectedCode && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              {actionLabel(action.type)}
            </span>
          )}
          {action.expirationText && (
            <span className="text-[10px] text-red-600 font-medium">⏱ {action.expirationText}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {item.needsReply && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDraftReply() }}
            disabled={draftLoading}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white disabled:opacity-60 hover:bg-blue-700 transition"
          >
            {draftLoading ? "Generating…" : "Draft Reply"}
          </button>
        )}
        {item.approvalReason && !item.needsReply && (
          <button
            onClick={(e) => { e.stopPropagation(); router.push(item.href) }}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Review Draft
          </button>
        )}
        {action?.actionLink && (
          <a
            href={action.actionLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition"
          >
            Open link →
          </a>
        )}
        {item.needsReply && (
          <button
            onClick={handleWaitingOn}
            className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
          >
            Waiting On
          </button>
        )}
        <button
          onClick={handleDone}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
        >
          Done
        </button>
        <div ref={snoozeRef} className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowSnooze((v) => !v) }}
            className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
          >
            Snooze
          </button>
          {showSnooze && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-full mt-1 z-20 min-w-[160px] rounded-xl border border-slate-200 bg-white shadow-md py-1"
            >
              {SNOOZE_PRESETS.map(({ label, getDate }) => (
                <button
                  key={label}
                  type="button"
                  onClick={(e) => handleSnooze(e, getDate)}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 transition"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {draftError && <span className="text-[10px] text-red-500">{draftError}</span>}
        {doneError && <span className="text-[10px] text-red-500">{doneError}</span>}
        {snoozeError && <span className="text-[10px] text-red-500">{snoozeError}</span>}
      </div>
    </div>
  )
}

interface Props {
  items: CommandCenterConversation[]
}

export default function HandleFirstSection({ items }: Props) {
  const seen = new Set<string>()
  const deduped = items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  if (deduped.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center">
        <p className="text-[11px] font-medium text-slate-600">All caught up</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Nothing needs your attention right now.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {deduped.slice(0, 5).map((item) => (
        <HandleFirstCard key={item.id} item={item} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/handle-first-section.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/components/HandleFirstSection.tsx tests/handle-first-section.test.ts
git commit -m "feat: add Snooze, Waiting On, and inline Done+undo to Handle First cards"
```

---

### Task 2: NeedsActionSection — rename microcopy

**Files:**
- Modify: `app/components/NeedsActionSection.tsx`

- [ ] **Step 1: Confirm test that currently passes references "Not needed"**

```bash
npx vitest run tests/needs-action-section.test.ts
```

Expected: PASS (the test checks for "Not needed", which is the old text)

- [ ] **Step 2: Update NeedsActionSection.tsx — change "Not needed" to "Handled" and "Saving..." to "Saving…"**

In `app/components/NeedsActionSection.tsx`, find line 153 (`{dismissing ? "Saving..." : "Not needed"}`). Change to:

```tsx
{dismissing ? "Saving…" : "Handled"}
```

- [ ] **Step 3: Update test to match new text**

In `tests/needs-action-section.test.ts`, change:

```typescript
expect(source).toContain("Not needed")
```

to:

```typescript
expect(source).toContain("Handled")
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/needs-action-section.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/NeedsActionSection.tsx tests/needs-action-section.test.ts
git commit -m "fix: rename 'Not needed' to 'Handled' in NeedsActionSection"
```

---

### Task 3: BillsDeadlinesList — fix endpoint + labeled buttons

**Files:**
- Modify: `app/components/BillsDeadlinesList.tsx`

The bug: conversation items call `PATCH /api/conversations/[id]/attention` with `{ attentionCategory: "fyi_done" }`. That endpoint exists but writes attentionCategory, not userState — so the item reappears after refresh.

The fix: call `PATCH /api/conversations/[id]/workflow-status` with `{ workflowStatus: "done" }` instead.

Also: replace the single hidden icon button with two labeled text buttons ("Done" and "Not relevant") that are visible on group-hover.

- [ ] **Step 1: Write the test**

Create `tests/bills-deadlines-list.test.ts`:

```typescript
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("BillsDeadlinesList", () => {
  it("calls workflow-status endpoint for conversation dismiss", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/BillsDeadlinesList.tsx"),
      "utf8"
    )
    expect(source).toContain('/api/conversations/${item.conversationId}/workflow-status')
    expect(source).toContain('workflowStatus: "done"')
    expect(source).not.toContain('/attention')
    expect(source).not.toContain('attentionCategory')
  })

  it("has Done and Not relevant labeled buttons", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/BillsDeadlinesList.tsx"),
      "utf8"
    )
    expect(source).toContain(">Done<")
    expect(source).toContain(">Not relevant<")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/bills-deadlines-list.test.ts
```

Expected: FAIL (still calls /attention)

- [ ] **Step 3: Implement BillsDeadlinesList**

Replace the entire file `app/components/BillsDeadlinesList.tsx` with:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { BillSignal } from "@/lib/agent/command-center"

interface ItemRowProps {
  item: BillSignal
}

function BillItem({ item }: ItemRowProps) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dismissed) return null

  async function handleDismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDismissed(true)
    setError(null)
    try {
      let res: Response
      if (item.type === "task" && item.taskId) {
        res = await fetch(`/api/tasks/${item.taskId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "closed" }),
        })
      } else {
        res = await fetch(`/api/conversations/${item.conversationId}/workflow-status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowStatus: "done" }),
        })
      }
      if (!res.ok) throw new Error("Failed to dismiss")
      router.refresh()
    } catch {
      setDismissed(false)
      setError("Couldn't dismiss")
    }
  }

  return (
    <li className="group flex items-start justify-between gap-2">
      <a href={item.href} className="flex-1 min-w-0 flex items-start justify-between gap-2 text-sm hover:underline">
        <span className="min-w-0">
          <span className="font-medium text-slate-800">{item.displayName}</span>
          <span className="ml-1.5 text-slate-500">{item.title}</span>
        </span>
        {item.dueAt && (
          <span className="shrink-0 whitespace-nowrap text-xs text-amber-600">
            Due {item.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </a>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
        {error && <span className="text-[10px] text-red-500">{error}</span>}
        <button
          type="button"
          onClick={handleDismiss}
          className="text-[10px] font-medium px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:opacity-100"
          aria-label="Done"
        >
          Done
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-[10px] font-medium px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:opacity-100"
          aria-label="Not relevant"
        >
          Not relevant
        </button>
      </div>
    </li>
  )
}

interface Props {
  items: BillSignal[]
}

export default function BillsDeadlinesList({ items }: Props) {
  return (
    <ul className="mt-3 space-y-2">
      {items.map((item) => (
        <BillItem key={`${item.conversationId}-${item.title}`} item={item} />
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/bills-deadlines-list.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/BillsDeadlinesList.tsx tests/bills-deadlines-list.test.ts
git commit -m "fix: Bills dismiss calls workflow-status, add 'Done'/'Not relevant' labeled buttons"
```

---

### Task 4: ReadLaterSection — labeled buttons + inline undo + fix link

**Files:**
- Modify: `app/components/ReadLaterSection.tsx`

Changes:
1. Replace two icon-only buttons with "Done" and "Not interested" text buttons
2. "Done" shows inline undo (card shows "Marked as done · Undo" for 5 s, then removes)
3. "Not interested" does the same dismiss call with no undo
4. Fix "+N more" span → link to `/inbox?attention=read_later`
5. Add `useRef` + `useEffect` cleanup for the undo timer

Note: `handleDone` for the "Not interested" button skips the undo (removes immediately). The undo pattern is per-card: `useState<"idle"|"undoable"|"done">` + `useRef<ReturnType<typeof setTimeout>>`.

- [ ] **Step 1: Write the test**

Create `tests/read-later-section.test.ts`:

```typescript
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("ReadLaterSection", () => {
  it("has Done and Not interested labeled buttons", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/ReadLaterSection.tsx"),
      "utf8"
    )
    expect(source).toContain(">Done<")
    expect(source).toContain(">Not interested<")
    expect(source).not.toContain("Mark as FYI")
    expect(source).not.toContain("Mark as Quiet")
  })

  it("has inline undo state", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/ReadLaterSection.tsx"),
      "utf8"
    )
    expect(source).toContain("undoable")
    expect(source).toContain("undoTimerRef")
    expect(source).toContain("Undo")
  })

  it("links +N more to /inbox?attention=read_later", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/ReadLaterSection.tsx"),
      "utf8"
    )
    expect(source).toContain("/inbox?attention=read_later")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/read-later-section.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement ReadLaterSection**

Replace the entire file `app/components/ReadLaterSection.tsx` with:

```tsx
"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { CommandCenterConversation } from "@/lib/agent/command-center"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / 86400000)
  return `${days}d ago`
}

const EMAIL_TYPE_LABEL: Record<string, string> = {
  newsletter: "Newsletter",
  notification: "Update",
  marketing: "Promo",
  fyi: "FYI",
}

interface CardProps {
  item: CommandCenterConversation
}

function ReadLaterCard({ item }: CardProps) {
  const router = useRouter()
  const [doneState, setDoneState] = useState<"idle" | "undoable" | "done">("idle")
  const [error, setError] = useState<string | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  if (doneState === "done") return null

  async function markDone(e: React.MouseEvent, withUndo: boolean) {
    e.preventDefault()
    e.stopPropagation()
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: "done" }),
      })
      if (!res.ok) throw new Error()
      if (withUndo) {
        setDoneState("undoable")
        undoTimerRef.current = setTimeout(() => {
          setDoneState("done")
          router.refresh()
        }, 5000)
      } else {
        setDoneState("done")
        router.refresh()
      }
    } catch {
      setError("Couldn't update")
    }
  }

  function handleUndo(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setDoneState("idle")
    fetch(`/api/conversations/${item.id}/workflow-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowStatus: "read_later" }),
    })
  }

  if (doneState === "undoable") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <span className="text-[11px] text-slate-500">Marked as done</span>
        <button
          onClick={handleUndo}
          className="text-[10px] font-semibold text-blue-600 hover:underline"
        >
          Undo
        </button>
      </div>
    )
  }

  return (
    <div className="group relative flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 transition">
      <a href={item.href} className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-700 truncate">{item.displayName}</p>
        <p className="text-[10px] text-slate-500 truncate mt-0.5">{item.reason}</p>
        {item.emailType && (
          <span className="inline-block mt-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
            {EMAIL_TYPE_LABEL[item.emailType] ?? item.emailType}
          </span>
        )}
      </a>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[10px] text-slate-400 mt-0.5">{relativeTime(item.lastMessageAt)}</span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
          {error && <span className="text-[9px] text-red-500 self-center mr-1">{error}</span>}
          <button
            type="button"
            onClick={(e) => markDone(e, true)}
            className="text-[10px] font-medium px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:opacity-100"
          >
            Done
          </button>
          <button
            type="button"
            onClick={(e) => markDone(e, false)}
            className="text-[10px] font-medium px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:opacity-100"
          >
            Not interested
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  items: CommandCenterConversation[]
}

export default function ReadLaterSection({ items }: Props) {
  const preview = items.slice(0, 3)
  const overflow = items.length - preview.length

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Read Later</p>
        {overflow > 0 && (
          <a href="/inbox?attention=read_later" className="text-[10px] text-blue-500 hover:underline">
            +{overflow} more
          </a>
        )}
      </div>
      {preview.length === 0 ? (
        <p className="text-[10px] text-slate-400 px-1">Nothing queued to read.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {preview.map((item) => (
            <ReadLaterCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/read-later-section.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ReadLaterSection.tsx tests/read-later-section.test.ts
git commit -m "feat: ReadLaterSection labeled buttons, inline undo, fix +N more link"
```

---

### Task 5: QuietlyHandledBanner — fix link and microcopy

**Files:**
- Modify: `app/components/QuietlyHandledBanner.tsx`

Two changes:
1. `href="/inbox?attention=fyi_done"` → `href="/inbox?status=closed"` (the inbox STATUS_FILTERS already supports `status=closed` and shows all done conversations regardless of how they were marked)
2. `"emails quietly handled"` → `"emails sorted quietly"`

- [ ] **Step 1: Write the test**

Create `tests/quietly-handled-banner.test.ts`:

```typescript
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("QuietlyHandledBanner", () => {
  it("links to /inbox?status=closed", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/QuietlyHandledBanner.tsx"),
      "utf8"
    )
    expect(source).toContain("/inbox?status=closed")
    expect(source).not.toContain("attention=fyi_done")
  })

  it("uses updated microcopy", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/QuietlyHandledBanner.tsx"),
      "utf8"
    )
    expect(source).toContain("emails sorted quietly")
    expect(source).not.toContain("emails quietly handled")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/quietly-handled-banner.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement changes in QuietlyHandledBanner.tsx**

In `app/components/QuietlyHandledBanner.tsx`:

Change line 23:
```tsx
<p className="text-[11px] font-medium text-slate-500">emails quietly handled</p>
```
to:
```tsx
<p className="text-[11px] font-medium text-slate-500">emails sorted quietly</p>
```

Change line 36:
```tsx
href="/inbox?attention=fyi_done"
```
to:
```tsx
href="/inbox?status=closed"
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/quietly-handled-banner.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/QuietlyHandledBanner.tsx tests/quietly-handled-banner.test.ts
git commit -m "fix: QuietlyHandledBanner links to /inbox?status=closed, 'emails sorted quietly'"
```

---

### Task 6: AgentActivitySection + HomeCommandCenter — breakdown activity lines

**Files:**
- Modify: `app/components/AgentActivitySection.tsx`
- Modify: `app/components/HomeCommandCenter.tsx`

**AgentActivitySection changes:**
- Add `quietlyHandledBreakdown: QuietlyHandledBreakdown` to props interface
- Add newsletter row: "Moved N newsletters & updates to Quiet" (if `newsletter + notification + marketing > 0`)
- Rename "Sorted N emails into categories" → "Sorted N emails today"
- Remove "Found N items needing action" row (also remove `needsActionCount` prop)
- Change "Updated your preferences from feedback" → "Learned from your recent feedback"
- Change empty state to "All quiet — no activity in the last 24 hours."

**HomeCommandCenter changes:**
- Pass `quietlyHandledBreakdown` to `AgentActivitySection`
- Remove `needsActionCount` prop from `AgentActivitySection` call

- [ ] **Step 1: Write the test**

Create `tests/agent-activity-section.test.ts`:

```typescript
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("AgentActivitySection", () => {
  it("accepts quietlyHandledBreakdown prop", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/AgentActivitySection.tsx"),
      "utf8"
    )
    expect(source).toContain("quietlyHandledBreakdown")
    expect(source).toContain("QuietlyHandledBreakdown")
  })

  it("shows newsletters moved row", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/AgentActivitySection.tsx"),
      "utf8"
    )
    expect(source).toContain("newsletters")
    expect(source).toContain("Quiet")
  })

  it("does not have needsActionCount", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/AgentActivitySection.tsx"),
      "utf8"
    )
    expect(source).not.toContain("needsActionCount")
    expect(source).not.toContain("needing action")
  })

  it("has updated empty state", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/AgentActivitySection.tsx"),
      "utf8"
    )
    expect(source).toContain("All quiet")
    expect(source).not.toContain("No agent activity yet")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/agent-activity-section.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement AgentActivitySection.tsx**

Replace the entire file `app/components/AgentActivitySection.tsx` with:

```tsx
import type { AgentSummary, QuietlyHandledBreakdown } from "@/lib/agent/command-center"

interface ActivityRow {
  icon: string
  text: string
  timestamp: string
}

interface Props {
  agentSummary: AgentSummary
  quietlyHandledBreakdown: QuietlyHandledBreakdown
}

export default function AgentActivitySection({ agentSummary, quietlyHandledBreakdown }: Props) {
  const rows: ActivityRow[] = []

  if (agentSummary.classifiedLast24h > 0) {
    rows.push({
      icon: "✦",
      text: `Sorted ${agentSummary.classifiedLast24h} email${agentSummary.classifiedLast24h === 1 ? "" : "s"} today`,
      timestamp: "today",
    })
  }

  const quietCount = quietlyHandledBreakdown.newsletter + quietlyHandledBreakdown.notification + quietlyHandledBreakdown.marketing
  if (quietCount > 0) {
    rows.push({
      icon: "✦",
      text: `Moved ${quietCount} newsletter${quietCount === 1 ? "" : "s"} & update${quietCount === 1 ? "" : "s"} to Quiet`,
      timestamp: "today",
    })
  }

  if (agentSummary.draftedLast24h > 0) {
    rows.push({
      icon: "✉",
      text: `Drafted ${agentSummary.draftedLast24h} ${agentSummary.draftedLast24h === 1 ? "reply" : "replies"} for your review`,
      timestamp: "today",
    })
  }

  if (agentSummary.learnedRecentlyUpdated) {
    rows.push({
      icon: "🧠",
      text: "Learned from your recent feedback",
      timestamp: "this week",
    })
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <p className="text-[10px] font-bold uppercase tracking-wide text-green-600">Agent Activity</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        {rows.length === 0 ? (
          <p className="text-[10px] text-slate-400">All quiet — no activity in the last 24 hours.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[11px] w-4 text-center flex-shrink-0 mt-px">{row.icon}</span>
                <span className="text-[11px] text-slate-500 flex-1 leading-snug">{row.text}</span>
                <span className="text-[10px] text-slate-400 flex-shrink-0">{row.timestamp}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update HomeCommandCenter.tsx — pass quietlyHandledBreakdown, remove needsActionCount**

In `app/components/HomeCommandCenter.tsx`, find the `AgentActivitySection` usage (around line 83-86):

```tsx
<AgentActivitySection
  agentSummary={agentSummary}
  needsActionCount={counts.needsAction}
/>
```

Replace with:

```tsx
<AgentActivitySection
  agentSummary={agentSummary}
  quietlyHandledBreakdown={quietlyHandledBreakdown}
/>
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/agent-activity-section.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/components/AgentActivitySection.tsx app/components/HomeCommandCenter.tsx tests/agent-activity-section.test.ts
git commit -m "feat: AgentActivitySection shows breakdown-level activity lines"
```

---

### Task 7: Final verification and push

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: Build completes successfully with no errors

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review Checklist

- [x] **Handle First** — Snooze (3 presets + popover), Waiting On, Done renamed, inline undo ✓ (Task 1)
- [x] **NeedsAction** — "Not needed"→"Handled", "Saving..."→"Saving…" ✓ (Task 2)
- [x] **Bills** — conversation dismiss calls `/workflow-status`, "Done" + "Not relevant" buttons ✓ (Task 3)
- [x] **Read Later** — "Done" + "Not interested" labeled buttons, inline undo, "+N more" link fixed ✓ (Task 4)
- [x] **Quietly Handled** — link to `/inbox?status=closed`, "emails sorted quietly" ✓ (Task 5)
- [x] **Agent Activity** — `quietlyHandledBreakdown` prop, newsletter row, removed needsActionCount, empty state updated ✓ (Task 6)
- [x] **Test** for needs-action-section updated to "Handled" ✓ (Task 2)
- [x] TypeCheck + lint + build in final task ✓ (Task 7)
- [x] No placeholder text anywhere in plan ✓
- [x] Types consistent: `QuietlyHandledBreakdown` imported from `@/lib/agent/command-center` in both files ✓
