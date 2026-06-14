# Home Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the FlowDesk Home page into an asymmetric 60/40 AI command center with real data, real action buttons, and no dead whitespace.

**Architecture:** Extend `lib/agent/command-center.ts` with new `needsAction`/`readLater` fields, add a server-side `agentSummary` query in `app/inbox/page.tsx`, then rebuild `HomeCommandCenter.tsx` using focused sub-components — two of which are client components (`HomeHeader`, `HandleFirstSection`) and the rest are server-side display components.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Prisma, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/agent/command-center.ts` | Modify | Add `needsAction`, `emailType`, `readLater` to types + logic |
| `tests/command-center.test.ts` | Modify | Tests for new fields |
| `app/inbox/page.tsx` | Modify | Add `agentSummary` query, update props passed to HomeCommandCenter |
| `app/components/HomeCommandCenter.tsx` | Rewrite | Layout-only wrapper, 60/40 grid, imports sub-components |
| `app/components/HomeHeader.tsx` | Create | `"use client"` — greeting + inline GmailSyncControl |
| `app/components/HomeStats.tsx` | Create | 5 stat pills (pure display, no interactivity) |
| `app/components/HandleFirstSection.tsx` | Create | `"use client"` — priority cards with Draft Reply + Mark Done |
| `app/components/NeedsActionSection.tsx` | Create | Amber strip cards, navigation links only |
| `app/components/ReadLaterSection.tsx` | Create | Right-column newsletter/content cards |
| `app/components/WaitingOnSection.tsx` | Create | Right-column waiting-on cards with Nudge link |
| `app/components/AgentActivitySection.tsx` | Create | Right-column activity log, pure display |
| `app/components/QuietlyHandledBanner.tsx` | Create | Full-width bottom banner with breakdown pills |

---

## Task 1: Extend command-center types and logic

**Files:**
- Modify: `lib/agent/command-center.ts`

- [ ] **Step 1: Add `needsAction` and `emailType` to `CommandCenterConversation`, and new counts/sections to `DailyCommandCenter`**

In `lib/agent/command-center.ts`, update the two type definitions and `buildDailyCommandCenter`. Find the `CommandCenterConversation` type (currently ends with `estimatedValue`) and replace it:

```ts
export type CommandCenterConversation = {
  id: string
  displayName: string
  state: CommandCenterState
  priority: CommandCenterPriority
  reason: string
  nextAction: string
  href: string
  lastMessageAt: Date
  label: string | null
  sensitive: boolean
  approvalReason: string | null
  safelyIgnored: boolean
  needsReply: boolean
  needsAction: boolean        // NEW: attentionCategory === "needs_action"
  opportunity: boolean
  leadScore: number | null
  estimatedValue: number | null
  emailType: string | null    // NEW: from metadataJson.emailType, used for breakdown
}
```

Find the `DailyCommandCenter` type and replace it:

```ts
export type AgentSummary = {
  classifiedLast24h: number
  draftedLast24h: number
  learnedRecentlyUpdated: boolean
}

export type QuietlyHandledBreakdown = {
  newsletter: number
  notification: number
  marketing: number
  other: number
}

export type DailyCommandCenter = {
  headline: string
  droppedBallMessage: string
  counts: {
    needsReply: number
    needsAction: number          // NEW
    waitingOnThem: number
    waitingOnYou: number
    meetings: number
    approvals: number
    opportunities: number
    potentialProblems: number
    support: number
    salesQualified: number
    safelyIgnored: number
    readLater: number            // NEW
  }
  topActions: CommandCenterConversation[]
  sections: {
    needsReply: CommandCenterConversation[]
    needsAction: CommandCenterConversation[]    // NEW
    waitingOnThem: CommandCenterConversation[]
    meetings: CommandCenterConversation[]
    approvals: CommandCenterConversation[]
    opportunities: CommandCenterConversation[]
    potentialProblems: CommandCenterConversation[]
    support: CommandCenterConversation[]
    salesQualified: CommandCenterConversation[]
    readLater: CommandCenterConversation[]      // NEW
    safelyIgnored: CommandCenterConversation[]
  }
  quietlyHandledBreakdown: QuietlyHandledBreakdown  // NEW
  conversations: CommandCenterConversation[]
}
```

- [ ] **Step 2: Set `needsAction` and `emailType` in `analyzeConversationForCommandCenter`**

Find the `return {` block at the end of `analyzeConversationForCommandCenter` (currently returns 13 fields) and add the two new fields. Also capture `attentionCategory` as a local variable at the top of the function where `const attentionCategory = getAttentionCategory(conversation)` already exists — no new variable needed. Update the return statement:

```ts
  return {
    id: conversation.id,
    displayName: displayName(conversation),
    state,
    priority,
    reason,
    nextAction,
    href: `/conversations/${conversation.id}`,
    lastMessageAt: conversation.lastMessageAt,
    label: conversation.label,
    sensitive,
    approvalReason: approvalReason(conversation),
    safelyIgnored: state === "done" || safelyIgnored,
    needsReply: conversation.status === "needs_reply" && !safelyIgnored && (!attentionCategory || attentionCategory === "needs_reply"),
    needsAction: attentionCategory === "needs_action",   // NEW
    opportunity,
    leadScore: opportunity && conversation.lead ? conversation.lead.score : null,
    estimatedValue: conversation.lead?.estimatedValue ?? null,
    emailType: getEmailType(conversation),               // NEW
  }
```

- [ ] **Step 3: Set `needsAction` and `emailType` in `persistedStateToCommandCenterConversation`**

Find the `return {` block in `persistedStateToCommandCenterConversation` and add the two new fields:

```ts
  return {
    id: conversation.id,
    displayName: conversation.contact?.name ?? conversation.externalThreadId,
    state: persisted.state as CommandCenterState,
    priority: persisted.priority as CommandCenterPriority,
    reason: persisted.reason,
    nextAction: persisted.nextAction,
    href: `/conversations/${conversation.id}`,
    lastMessageAt: conversation.lastMessageAt,
    label: conversation.label,
    sensitive,
    approvalReason: approvalReasonStr,
    safelyIgnored:
      persisted.state === "done" ||
      (persisted.state === "fyi_only" && meta?.attentionCategory !== "read_later"),
    needsReply:
      conversation.status === "needs_reply" &&
      persisted.state !== "fyi_only" &&
      (!meta?.attentionCategory || meta.attentionCategory === "needs_reply"),
    needsAction: meta?.attentionCategory === "needs_action",   // NEW
    opportunity,
    leadScore: opportunity && lead ? lead.score : null,
    estimatedValue: lead?.estimatedValue ?? null,
    emailType: typeof meta?.emailType === "string" ? meta.emailType : null,  // NEW
  }
```

- [ ] **Step 4: Update `buildDailyCommandCenter` to populate new fields**

Find the `return {` block in `buildDailyCommandCenter`. Replace the entire return statement:

```ts
  const needsActionItems = analyzed.filter(c => c.needsAction)
  const readLaterItems = analyzed.filter(c => {
    const meta = c  // c already has state/priority from analysis
    return !c.safelyIgnored && c.state === "fyi_only" && c.priority === "low"
  })

  // Compute breakdown from safelyIgnored items
  const safelyIgnoredItems = analyzed.filter(c => c.safelyIgnored)
  const breakdown: QuietlyHandledBreakdown = { newsletter: 0, notification: 0, marketing: 0, other: 0 }
  for (const item of safelyIgnoredItems) {
    if (item.emailType === "newsletter") breakdown.newsletter++
    else if (item.emailType === "notification") breakdown.notification++
    else if (item.emailType === "marketing") breakdown.marketing++
    else breakdown.other++
  }

  return {
    headline:
      importantCount === 0
        ? "Nothing urgent needs your attention today."
        : `Here are the ${importantCount} things that actually matter today.`,
    droppedBallMessage:
      topActions.length === 0 ? "You have 0 dropped balls." : `${topActions.length} open item${topActions.length === 1 ? "" : "s"} to handle.`,
    counts: {
      needsReply: analyzed.filter(c => c.needsReply).length,
      needsAction: needsActionItems.length,
      waitingOnThem: analyzed.filter(c => c.state === "waiting_on_them").length,
      waitingOnYou: analyzed.filter(c => c.state === "waiting_on_you").length,
      meetings: analyzed.filter(c => c.state === "scheduled").length,
      approvals: approvals.length,
      opportunities: analyzed.filter(c => c.opportunity).length,
      potentialProblems: analyzed.filter(c => c.sensitive).length,
      support: analyzed.filter(c => c.state === "support").length,
      salesQualified: analyzed.filter(c => c.state === "sales_qualified").length,
      safelyIgnored: safelyIgnoredItems.length,
      readLater: readLaterItems.length,
    },
    topActions,
    sections: {
      needsReply: analyzed.filter(c => c.state === "needs_reply"),
      needsAction: needsActionItems,
      waitingOnThem: analyzed.filter(c => c.state === "waiting_on_them"),
      meetings: analyzed.filter(c => c.state === "scheduled"),
      approvals,
      opportunities: analyzed.filter(c => c.opportunity),
      potentialProblems: analyzed.filter(c => c.sensitive),
      support: analyzed.filter(c => c.state === "support"),
      salesQualified: analyzed.filter(c => c.state === "sales_qualified"),
      readLater: readLaterItems,
      safelyIgnored: safelyIgnoredItems,
    },
    quietlyHandledBreakdown: breakdown,
    conversations: analyzed,
  }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to command-center types (there may be cascade errors in inbox/page.tsx and HomeCommandCenter.tsx — those are fixed in later tasks).

---

## Task 2: Tests for new command-center fields

**Files:**
- Modify: `tests/command-center.test.ts`

- [ ] **Step 1: Add tests for `needsAction` field**

Append to `tests/command-center.test.ts` after the existing `describe` blocks:

```ts
describe("needsAction flag", () => {
  it("is true when attentionCategory is needs_action", () => {
    const conv = conversation({
      conversationState: {
        metadataJson: { attentionCategory: "needs_action", emailType: "notification" },
      },
    })
    const result = analyzeConversationForCommandCenter(conv, now)
    expect(result.needsAction).toBe(true)
    expect(result.state).toBe("waiting_on_you")
    expect(result.priority).toBe("high")
  })

  it("is false when attentionCategory is needs_reply", () => {
    const conv = conversation({
      conversationState: {
        metadataJson: { attentionCategory: "needs_reply" },
      },
    })
    const result = analyzeConversationForCommandCenter(conv, now)
    expect(result.needsAction).toBe(false)
  })

  it("is false when no attentionCategory is set", () => {
    const result = analyzeConversationForCommandCenter(conversation(), now)
    expect(result.needsAction).toBe(false)
  })
})

describe("emailType field", () => {
  it("returns the emailType from metadataJson", () => {
    const conv = conversation({
      conversationState: {
        metadataJson: { emailType: "newsletter", attentionCategory: "quiet" },
      },
    })
    const result = analyzeConversationForCommandCenter(conv, now)
    expect(result.emailType).toBe("newsletter")
  })

  it("returns null when no emailType in metadataJson", () => {
    const result = analyzeConversationForCommandCenter(conversation(), now)
    expect(result.emailType).toBeNull()
  })
})

describe("buildDailyCommandCenter new sections", () => {
  it("populates sections.needsAction", () => {
    const actionConv = conversation({
      id: "action-1",
      conversationState: {
        metadataJson: { attentionCategory: "needs_action" },
      },
    })
    const result = buildDailyCommandCenter([actionConv, conversation({ id: "normal-1" })], now)
    expect(result.sections.needsAction).toHaveLength(1)
    expect(result.sections.needsAction[0].id).toBe("action-1")
    expect(result.counts.needsAction).toBe(1)
  })

  it("populates sections.readLater", () => {
    const readLaterConv = conversation({
      id: "rl-1",
      conversationState: {
        metadataJson: { attentionCategory: "read_later" },
      },
    })
    const result = buildDailyCommandCenter([readLaterConv, conversation({ id: "normal-1" })], now)
    expect(result.sections.readLater).toHaveLength(1)
    expect(result.sections.readLater[0].id).toBe("rl-1")
    expect(result.counts.readLater).toBe(1)
  })

  it("computes quietlyHandledBreakdown from safelyIgnored emails", () => {
    const newsletter = conversation({
      id: "nl-1",
      conversationState: {
        metadataJson: { emailType: "newsletter", attentionCategory: "quiet" },
      },
    })
    const notification = conversation({
      id: "notif-1",
      conversationState: {
        metadataJson: { emailType: "notification", attentionCategory: "quiet" },
      },
    })
    const result = buildDailyCommandCenter([newsletter, notification], now)
    expect(result.quietlyHandledBreakdown.newsletter).toBe(1)
    expect(result.quietlyHandledBreakdown.notification).toBe(1)
    expect(result.quietlyHandledBreakdown.marketing).toBe(0)
    expect(result.quietlyHandledBreakdown.other).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox
npm test -- --reporter=verbose 2>&1 | tail -40
```

Expected: all new tests pass, existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/command-center.ts tests/command-center.test.ts
git commit -m "feat: add needsAction, readLater, emailType to command center"
```

---

## Task 3: Add agentSummary query to inbox page and update HomeCommandCenter props

**Files:**
- Modify: `app/inbox/page.tsx`

- [ ] **Step 1: Add the `AgentSummary` import at the top of the file**

In `app/inbox/page.tsx`, the existing import from `@/lib/agent/command-center` currently imports several types. Add `AgentSummary` to it:

```ts
import { buildDailyCommandCenter, CommandCenterInputConversation, PersistedCommandCenterState, CommandCenterState, CommandCenterPriority, type AgentSummary } from "@/lib/agent/command-center"
```

- [ ] **Step 2: Add the agentSummary query AFTER the existing big query block**

Do NOT touch the existing `[commandCenterConversations, ignoredStates, pendingFollowUps, revenueAtRisk, persistedStates]` destructuring — it is large and correct as-is. Instead, find the line where `commandCenter` is built (`const commandCenter = isHomeView ? buildDailyCommandCenter(...)`) and insert these queries immediately after:

```ts
  const agentSummaryRaw: [number, number, { id: string } | null] = isHomeView
    ? await Promise.all([
        prisma.conversationState.count({
          where: {
            tenantId,
            updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.draft.count({
          where: {
            conversation: { tenantId },
            status: "proposed",
            updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.learnedReplyProfile.findFirst({
          where: {
            tenantId,
            updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
          select: { id: true },
        }),
      ])
    : [0, 0, null]

  const [classifiedLast24h, draftedLast24h, learnedProfile] = agentSummaryRaw
  const agentSummary: AgentSummary = {
    classifiedLast24h,
    draftedLast24h,
    learnedRecentlyUpdated: learnedProfile !== null,
  }
```

- [ ] **Step 4: Update the `HomeCommandCenter` usage in the desktop shell**

Find the `<HomeCommandCenter` JSX in the desktop `DesktopResizablePanels` main prop. Replace it with the updated props (remove `followUps` and `ignoredItems`, add `agentSummary` and `gmailChannels`):

```tsx
              <HomeCommandCenter
                commandCenter={commandCenter}
                revenueAtRisk={revenueAtRisk as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>}
                agentSummary={agentSummary}
                accountType={accountType}
                date={new Date()}
                gmailChannels={gmailSyncChannels}
              />
```

- [ ] **Step 5: Update the `HomeCommandCenter` usage in the mobile layout**

Find the second `<HomeCommandCenter` JSX inside the mobile `isHomeView` block and apply the same prop changes:

```tsx
              <HomeCommandCenter
                commandCenter={commandCenter}
                revenueAtRisk={revenueAtRisk as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>}
                agentSummary={agentSummary}
                accountType={accountType}
                date={new Date()}
                gmailChannels={gmailSyncChannels}
              />
```

- [ ] **Step 6: Verify TypeScript compiles (expect errors in HomeCommandCenter.tsx — those are fixed in Task 12)**

```bash
npx tsc --noEmit 2>&1 | grep -v "HomeCommandCenter" | head -20
```

Expected: errors only in `HomeCommandCenter.tsx` (props mismatch); no errors in `inbox/page.tsx` or `command-center.ts`.

- [ ] **Step 7: Commit**

```bash
git add app/inbox/page.tsx
git commit -m "feat: add agentSummary query and update HomeCommandCenter props in inbox page"
```

---

## Task 4: Create HomeHeader component

**Files:**
- Create: `app/components/HomeHeader.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client"

import GmailSyncControl from "@/app/components/GmailSyncControl"

type GmailSyncChannel = {
  id: string
  emailAddress: string | null
  lastSyncedAt: Date | string | null
  lastSyncError: string | null
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

- [ ] **Step 2: Commit**

```bash
git add app/components/HomeHeader.tsx
git commit -m "feat: add HomeHeader component with inline sync"
```

---

## Task 5: Create HomeStats component

**Files:**
- Create: `app/components/HomeStats.tsx`

- [ ] **Step 1: Create the file**

```tsx
interface StatPill {
  label: string
  value: number
  accent: "red" | "amber" | "blue" | "neutral" | "dim"
}

interface Props {
  pills: StatPill[]
}

const ACCENT_CLASSES: Record<StatPill["accent"], string> = {
  red: "text-red-600",
  amber: "text-amber-600",
  blue: "text-blue-600",
  neutral: "text-slate-700",
  dim: "text-slate-300",
}

export default function HomeStats({ pills }: Props) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {pills.map(({ label, value, accent }) => (
        <div
          key={label}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5"
        >
          <span className={`text-base font-extrabold leading-none ${ACCENT_CLASSES[accent]}`}>
            {value}
          </span>
          <span className="text-[10px] font-medium text-slate-500">{label}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/HomeStats.tsx
git commit -m "feat: add HomeStats pill row component"
```

---

## Task 6: Create HandleFirstSection (client component)

**Files:**
- Create: `app/components/HandleFirstSection.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
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

interface CardProps {
  item: CommandCenterConversation
}

function HandleFirstCard({ item }: CardProps) {
  const router = useRouter()
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [doneError, setDoneError] = useState<string | null>(null)

  if (done) return null

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

  async function handleMarkDone() {
    setDone(true) // optimistic
    try {
      const res = await fetch(`/api/conversations/${item.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      })
      if (!res.ok) throw new Error("Failed to close")
    } catch {
      setDone(false)
      setDoneError("Couldn't mark as done")
    }
  }

  const priorityClass = PRIORITY_STYLES[item.priority] ?? ""

  return (
    <div className={`rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:shadow-sm ${priorityClass}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-[12px] font-semibold text-slate-900 truncate">{item.displayName}</p>
        <span className="text-[10px] text-slate-400 flex-shrink-0">{relativeTime(item.lastMessageAt)}</span>
      </div>
      <p className="text-[11px] text-slate-600 truncate mb-1">{item.nextAction}</p>
      <p className="text-[10px] text-slate-400 italic mb-2.5">{item.reason}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {item.needsReply && (
          <button
            onClick={handleDraftReply}
            disabled={draftLoading}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white disabled:opacity-60 hover:bg-blue-700 transition"
          >
            {draftLoading ? "Generating…" : "Draft Reply"}
          </button>
        )}
        {item.approvalReason && !item.needsReply && (
          <Link
            href={item.href}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Review Draft
          </Link>
        )}
        <Link
          href={item.href}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
        >
          Open
        </Link>
        <button
          onClick={handleMarkDone}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
        >
          Mark Done
        </button>
        {draftError && (
          <span className="text-[10px] text-red-500">{draftError}</span>
        )}
        {doneError && (
          <span className="text-[10px] text-red-500">{doneError}</span>
        )}
      </div>
    </div>
  )
}

interface Props {
  items: CommandCenterConversation[]
}

export default function HandleFirstSection({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center">
        <p className="text-[11px] font-medium text-slate-600">All caught up</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Nothing needs your attention right now.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {items.slice(0, 5).map((item) => (
        <HandleFirstCard key={item.id} item={item} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/HandleFirstSection.tsx
git commit -m "feat: add HandleFirstSection with Draft Reply and Mark Done"
```

---

## Task 7: Create NeedsActionSection component

**Files:**
- Create: `app/components/NeedsActionSection.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from "next/link"
import type { CommandCenterConversation } from "@/lib/agent/command-center"

interface Props {
  items: CommandCenterConversation[]
}

export default function NeedsActionSection({ items }: Props) {
  if (items.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">
          Needs Action
        </p>
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
          OTPs · Links · Security
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 hover:bg-amber-50 transition"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-amber-900">{item.displayName}</p>
              <p className="text-[11px] text-amber-800 truncate">{item.nextAction}</p>
              <p className="text-[10px] text-amber-600 italic mt-0.5">{item.reason}</p>
            </div>
            <span className="text-[10px] font-semibold text-amber-700 flex-shrink-0">Open →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/NeedsActionSection.tsx
git commit -m "feat: add NeedsActionSection for OTP and verification emails"
```

---

## Task 8: Create ReadLaterSection component

**Files:**
- Create: `app/components/ReadLaterSection.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from "next/link"
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
          <span className="text-[10px] text-blue-500">+{overflow} more</span>
        )}
      </div>
      {preview.length === 0 ? (
        <p className="text-[10px] text-slate-400 px-1">Nothing queued to read.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {preview.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 transition"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-slate-700 truncate">{item.displayName}</p>
                <p className="text-[10px] text-slate-500 truncate mt-0.5">{item.reason}</p>
                {item.emailType && (
                  <span className="inline-block mt-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                    {EMAIL_TYPE_LABEL[item.emailType] ?? item.emailType}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-400 flex-shrink-0 mt-0.5">
                {relativeTime(item.lastMessageAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/ReadLaterSection.tsx
git commit -m "feat: add ReadLaterSection for right column"
```

---

## Task 9: Create WaitingOnSection component

**Files:**
- Create: `app/components/WaitingOnSection.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from "next/link"
import type { CommandCenterConversation } from "@/lib/agent/command-center"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "1 day ago"
  return `${days} days ago`
}

interface Props {
  items: CommandCenterConversation[]
}

export default function WaitingOnSection({ items }: Props) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-blue-500 mb-2">
        Waiting On
      </p>
      {items.length === 0 ? (
        <p className="text-[10px] text-slate-400 px-1">Not waiting on anyone.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.slice(0, 4).map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 transition"
            >
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-800 truncate">{item.displayName}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{relativeTime(item.lastMessageAt)}</p>
              </div>
              <span className="text-[10px] font-semibold text-blue-500 border border-blue-200 bg-blue-50 rounded-md px-2 py-0.5 flex-shrink-0 hover:bg-blue-100 transition">
                Nudge →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/WaitingOnSection.tsx
git commit -m "feat: add WaitingOnSection for right column"
```

---

## Task 10: Create AgentActivitySection component

**Files:**
- Create: `app/components/AgentActivitySection.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { AgentSummary } from "@/lib/agent/command-center"

interface ActivityRow {
  icon: string
  text: string
  timestamp: string
}

interface Props {
  agentSummary: AgentSummary
  needsActionCount: number
}

export default function AgentActivitySection({ agentSummary, needsActionCount }: Props) {
  const rows: ActivityRow[] = []

  if (agentSummary.classifiedLast24h > 0) {
    rows.push({
      icon: "✦",
      text: `Sorted ${agentSummary.classifiedLast24h} email${agentSummary.classifiedLast24h === 1 ? "" : "s"} into categories`,
      timestamp: "today",
    })
  }

  if (needsActionCount > 0) {
    rows.push({
      icon: "⚠",
      text: `Found ${needsActionCount} item${needsActionCount === 1 ? "" : "s"} needing action`,
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
      text: "Updated your preferences from feedback",
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
          <p className="text-[10px] text-slate-400">No agent activity yet.</p>
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

- [ ] **Step 2: Commit**

```bash
git add app/components/AgentActivitySection.tsx
git commit -m "feat: add AgentActivitySection showing real agent events"
```

---

## Task 11: Create QuietlyHandledBanner component

**Files:**
- Create: `app/components/QuietlyHandledBanner.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from "next/link"
import type { QuietlyHandledBreakdown } from "@/lib/agent/command-center"

interface Props {
  count: number
  breakdown: QuietlyHandledBreakdown
}

export default function QuietlyHandledBanner({ count, breakdown }: Props) {
  if (count === 0) return null

  const pills: { label: string; value: number }[] = [
    { label: "newsletters", value: breakdown.newsletter },
    { label: "notifications", value: breakdown.notification },
    { label: "marketing", value: breakdown.marketing },
    { label: "other", value: breakdown.other },
  ].filter((p) => p.value > 0)

  return (
    <div className="mt-4 flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3">
      <span className="text-2xl font-extrabold text-slate-300 flex-shrink-0">{count}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-500">emails quietly handled</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {pills.map(({ label, value }) => (
            <span
              key={label}
              className="text-[9px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-500"
            >
              {value} {label}
            </span>
          ))}
        </div>
      </div>
      <Link
        href="/inbox?status=all"
        className="text-[10px] font-semibold text-slate-500 border border-slate-200 bg-slate-50 rounded-lg px-3 py-1.5 hover:bg-slate-100 transition flex-shrink-0"
      >
        Review all →
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/QuietlyHandledBanner.tsx
git commit -m "feat: add QuietlyHandledBanner with category breakdown"
```

---

## Task 12: Rewrite HomeCommandCenter as the layout wrapper

**Files:**
- Rewrite: `app/components/HomeCommandCenter.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
import type { DailyCommandCenter, AgentSummary } from "@/lib/agent/command-center"
import type { RevenueAtRiskItem } from "@/lib/agent/revenue-at-risk"
import HomeHeader from "@/app/components/HomeHeader"
import HomeStats from "@/app/components/HomeStats"
import HandleFirstSection from "@/app/components/HandleFirstSection"
import NeedsActionSection from "@/app/components/NeedsActionSection"
import ReadLaterSection from "@/app/components/ReadLaterSection"
import WaitingOnSection from "@/app/components/WaitingOnSection"
import AgentActivitySection from "@/app/components/AgentActivitySection"
import QuietlyHandledBanner from "@/app/components/QuietlyHandledBanner"

type GmailSyncChannel = {
  id: string
  emailAddress: string | null
  lastSyncedAt: Date | string | null
  lastSyncError: string | null
}

interface Props {
  commandCenter: DailyCommandCenter
  revenueAtRisk: RevenueAtRiskItem[]
  agentSummary: AgentSummary
  accountType: string | null
  date: Date
  gmailChannels: GmailSyncChannel[]
}

export default function HomeCommandCenter({
  commandCenter,
  agentSummary,
  date,
  gmailChannels,
}: Props) {
  const { counts, topActions, sections, quietlyHandledBreakdown } = commandCenter

  // firstName: session is not available in this server component. Pass null — HomeHeader
  // renders "Good morning" without a name rather than throwing.
  const firstName: string | null = null
  // NOTE: revenueAtRisk is accepted as a prop for future business-account use but is not
  // rendered in v1 of this redesign to keep the layout focused.

  const statPills = [
    { label: "Needs Reply", value: counts.needsReply, accent: "red" as const },
    { label: "Needs Action", value: counts.needsAction, accent: "amber" as const },
    { label: "Waiting On", value: counts.waitingOnThem, accent: "blue" as const },
    { label: "Read Later", value: counts.readLater, accent: "neutral" as const },
    { label: "Quietly Handled", value: counts.safelyIgnored, accent: "dim" as const },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-5 py-5 max-w-5xl">

        {/* Header */}
        <HomeHeader date={date} firstName={firstName} gmailChannels={gmailChannels} />

        {/* Stats */}
        <HomeStats pills={statPills} />

        {/* 60/40 body grid */}
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">

          {/* Left 60%: Handle First + Needs Action */}
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-red-500">
                ⚡ Handle First
              </p>
              <HandleFirstSection items={topActions} />
            </div>
            <NeedsActionSection items={sections.needsAction} />
          </div>

          {/* Right 40%: Read Later + Waiting On + Agent Activity */}
          <div className="flex flex-col gap-5">
            <ReadLaterSection items={sections.readLater} />
            <WaitingOnSection items={sections.waitingOnThem} />
            <AgentActivitySection
              agentSummary={agentSummary}
              needsActionCount={counts.needsAction}
            />
          </div>
        </div>

        {/* Full-width bottom: Quietly Handled */}
        <QuietlyHandledBanner
          count={counts.safelyIgnored}
          breakdown={quietlyHandledBreakdown}
        />

      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox
npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 3: Run the test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass (no regressions).

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/HomeCommandCenter.tsx
git commit -m "feat: rewrite HomeCommandCenter as 60/40 command-center layout"
```

---

## Task 13: QA and final commit

- [ ] **Step 1: Start the dev server and open the inbox home**

```bash
npm run dev
```

Open `http://localhost:3000/inbox` in a browser. Sign in if needed.

- [ ] **Step 2: Verify all sections render correctly**

Check each item in this list visually:

- [ ] Header shows greeting + date + sync button
- [ ] Stats row shows 5 pills with correct counts
- [ ] Handle First cards have subtle left-border tint (not heavy warning boxes)
- [ ] Handle First empty state shows compact "All caught up" card when list is empty
- [ ] "Draft Reply" button shows loading state when clicked; navigates to conversation on success
- [ ] "Mark Done" removes card optimistically
- [ ] "Open" navigates to conversation
- [ ] Needs Action section is hidden if no needs-action emails
- [ ] Read Later shows newsletters with tags; hides section header message when empty
- [ ] Waiting On shows "Nudge →" links; shows "Not waiting on anyone." when empty
- [ ] Agent Activity shows only events with real data (no rows if counts are 0)
- [ ] Quietly Handled banner is hidden when count is 0
- [ ] Layout is 60/40 on wide screens, single column on narrow/mobile
- [ ] No inbox list duplicated on the home page
- [ ] Existing conversation view still works when navigating from any card

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: home command center redesign — 60/40 layout with real data and actions"
```

- [ ] **Step 4: Push to main**

```bash
git push origin main
```

---

## Post-Implementation Notes

**What's deferred (no fake buttons added):**
- "Remind Later" — needs a `snoozedUntil` field on `Conversation` + PATCH route
- Nudge pre-populating a draft — needs `?intent=followup` handling in conversation page
- Read Later mark-as-read — needs PATCH on `ConversationState.attentionCategory`

**Where first name comes from:** `HomeCommandCenter` currently passes `firstName: null`. To show the user's name, pass it from `inbox/page.tsx` via `session.user.name?.split(" ")[0] ?? null`. This is a one-line improvement, not blocking.
