# Action-First Dashboard and Persistent Settings Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Home’s competing dashboard sections with one ranked action feed and three exact daily metrics, while keeping the desktop app rail visible throughout Settings.

**Architecture:** A pure `lib/home-action-feed.ts` module merges and deduplicates already-normalized command-center, approval, and task inputs. `app/home/page.tsx` remains the server data boundary, while a focused client component owns Done/undo/error behavior. Settings adopts the existing Assistant server-layout shell pattern.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5, Prisma 5, Tailwind CSS 4, Vitest 2.

## Global Constraints

- No database migration or new dependency.
- Home shows exactly `Received today`, `Handled by FlowDesk`, and `Need you` as permanent metrics.
- Queue priority is approvals, Handle First, overdue deadlines, remaining Needs Action, upcoming deadlines, stale follow-ups.
- Queue is deduplicated before its full count is computed and before it is limited to 10 rows.
- Existing approval, workflow-status, and task-status routes remain the only mutation paths.
- Desktop Settings uses `AppRail`; mobile does not render the desktop rail.
- Existing Mail, Tasks, Activity, Waiting On, and Read Later destinations remain available.

---

### Task 1: Pure Home Action Feed

**Files:**
- Create: `lib/home-action-feed.ts`
- Create: `tests/home-action-feed.test.ts`

**Interfaces:**
- Consumes: normalized approval, `CommandCenterConversation`, and `BillSignal` values.
- Produces: `buildHomeActionFeed(input): { items: HomeActionItem[]; total: number }` and the discriminated `HomeActionItem` union.

- [ ] **Step 1: Write failing ordering and deduplication tests**

```ts
import { describe, expect, it } from "vitest"
import { buildHomeActionFeed } from "@/lib/home-action-feed"

it("orders sources and lets the earliest source win conversation deduplication", () => {
  const result = buildHomeActionFeed({
    approvals: [{ id: "a1", conversationId: "c1", title: "Approve reply", subtitle: "Acme", createdAt: new Date("2026-07-11T10:00:00Z") }],
    topActions: [conversation("c1"), conversation("c2")],
    needsAction: [conversation("c3")],
    deadlines: [deadline("t1", "c4", new Date("2026-07-10T10:00:00Z"))],
    followUps: [conversation("c5")],
    now: new Date("2026-07-11T12:00:00Z"),
  })
  expect(result.items.map((item) => item.key)).toEqual([
    "approval:a1", "conversation:c2", "task:t1", "conversation:c3", "conversation:c5",
  ])
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/home-action-feed.test.ts`

Expected: FAIL because `@/lib/home-action-feed` does not exist.

- [ ] **Step 3: Implement the discriminated union and pure builder**

```ts
export type HomeActionItem =
  | { key: `approval:${string}`; kind: "approval"; title: string; subtitle: string; href: string; canComplete: false }
  | { key: `conversation:${string}`; kind: "reply" | "action" | "follow_up"; conversationId: string; title: string; subtitle: string; href: string; canComplete: true }
  | { key: `task:${string}`; kind: "deadline"; taskId: string; conversationId: string; title: string; subtitle: string; href: string; canComplete: true }

export function buildHomeActionFeed(input: HomeActionFeedInput) {
  const seenConversations = new Set<string>()
  const seenTasks = new Set<string>()
  const items: HomeActionItem[] = []
  // Append each ranked source in order; skip a conversation/task already seen.
  // Split deadline inputs by dueAt < now before remaining upcoming deadlines.
  const total = items.length
  return { items: items.slice(0, 10), total }
}
```

- [ ] **Step 4: Add truncation, stable-order, empty-input, and approval-safety tests**

```ts
expect(buildHomeActionFeed(manyItems(12)).items).toHaveLength(10)
expect(buildHomeActionFeed(manyItems(12)).total).toBe(12)
expect(buildHomeActionFeed(emptyInput())).toEqual({ items: [], total: 0 })
expect(result.items.find((item) => item.kind === "approval")?.canComplete).toBe(false)
```

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- tests/home-action-feed.test.ts`

Expected: all Home action-feed tests PASS.

- [ ] **Step 6: Commit the pure feed**

```bash
git add lib/home-action-feed.ts tests/home-action-feed.test.ts
git commit -m "feat(home): build unified action feed"
```

### Task 2: Action-First Home UI and Exact Metrics

**Files:**
- Create: `app/components/HomeActionFeed.tsx`
- Modify: `app/components/HomeCommandCenter.tsx`
- Modify: `app/home/page.tsx`
- Modify: `tests/dashboard-ui-contracts.test.ts`

**Interfaces:**
- Consumes: `HomeActionItem[]`, `total`, daily metrics, agent summary, sync state.
- Produces: one responsive action-first Home composition and client-side completion behavior.

- [ ] **Step 1: Add failing Home source-contract tests**

```ts
it("renders the action-first dashboard without legacy permanent sections", () => {
  const home = source("app/components/HomeCommandCenter.tsx")
  expect(home).toContain("Received today")
  expect(home).toContain("Handled by FlowDesk")
  expect(home).toContain("Need you")
  expect(home).toContain("Your action items")
  expect(home).toContain("What FlowDesk did today")
  expect(home).toContain("You’re caught up")
  expect(home).not.toContain("What needs you")
  expect(home).not.toContain("Tasks & Deadlines")
})

it("uses existing completion routes in the unified action feed", () => {
  const feed = source("app/components/HomeActionFeed.tsx")
  expect(feed).toContain('/api/conversations/${item.conversationId}/workflow-status')
  expect(feed).toContain('/api/tasks/${item.taskId}/status')
  expect(feed).toContain("Undo")
  expect(feed).toContain('aria-live="polite"')
})
```

- [ ] **Step 2: Run the dashboard contract tests and confirm RED**

Run: `npm test -- tests/dashboard-ui-contracts.test.ts`

Expected: FAIL because the action-first labels/component do not exist.

- [ ] **Step 3: Implement `HomeActionFeed` completion state**

```tsx
export default function HomeActionFeed({ items }: { items: HomeActionItem[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  async function complete(item: HomeActionItem) {
    if (!item.canComplete) return
    setHidden((current) => new Set(current).add(item.key))
    const request = item.kind === "deadline"
      ? fetch(`/api/tasks/${item.taskId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "closed" }) })
      : fetch(`/api/conversations/${item.conversationId}/workflow-status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowStatus: "done" }) })
    const response = await request.catch(() => null)
    if (!response?.ok) {
      setHidden((current) => { const next = new Set(current); next.delete(item.key); return next })
      setError("Could not complete that item. Please try again.")
    }
  }
  return <div aria-live="polite">
    {error && <p className="text-xs text-red-600">{error}</p>}
    {items.filter((item) => !hidden.has(item.key)).map((item) => (
      <article key={item.key}>
        <Link href={item.href}>{item.title}</Link>
        <p>{item.subtitle}</p>
        {item.canComplete && <button onClick={() => complete(item)}>Done</button>}
      </article>
    ))}
  </div>
}
```

- [ ] **Step 4: Replace the two-pillar composition with the approved single column**

```tsx
<DashboardHeader date={date} syncState={syncState} />
<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
  <Metric label="Received today" value={metrics.receivedToday} />
  <Metric label="Handled by FlowDesk" value={metrics.handledToday} />
  <Metric label="Need you" value={feed.total} emphasized />
</div>
<HomeActionFeed items={feed.items} />
<details><summary>What FlowDesk did today</summary>{activitySummary}</details>
```

- [ ] **Step 5: Add exact server queries and feed normalization**

```ts
const startOfToday = new Date()
startOfToday.setHours(0, 0, 0, 0)
const [receivedToday, handledToday, pendingApprovalItems] = await Promise.all([
  prisma.message.count({ where: { conversation: { tenantId }, direction: "inbound", createdAt: { gte: startOfToday } } }),
  prisma.conversationState.count({ where: { tenantId, updatedAt: { gte: startOfToday }, source: { notIn: ["user_override", "gmail_label"] }, conversation: { approvalRequests: { none: { status: "pending" } } } } }),
  prisma.approvalRequest.findMany({ where: { tenantId, status: "pending" }, orderBy: { createdAt: "asc" }, take: 20 }),
])
```

Use this exact non-action predicate for `handledToday`: `state in ["done", "read_later"] OR attentionCategory in ["quiet", "fyi_done"]`, combined with the source and pending-approval exclusions shown above. Normalize each pending approval as `{ id, conversationId, title, subtitle, createdAt }`, call `buildHomeActionFeed({ approvals, topActions: commandCenter.topActions, needsAction: commandCenter.sections.needsAction, deadlines: billsSection.items, followUps: commandCenter.sections.waitingOnThem, now })`, and pass the resulting `feed`, `{ receivedToday, handledToday }`, and Gmail channel state into both desktop and mobile `HomeCommandCenter` calls.

- [ ] **Step 6: Run focused Home tests and type-check through build**

Run: `npm test -- tests/home-action-feed.test.ts tests/dashboard-ui-contracts.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the Home redesign**

```bash
git add app/home/page.tsx app/components/HomeCommandCenter.tsx app/components/HomeActionFeed.tsx tests/dashboard-ui-contracts.test.ts
git commit -m "feat(home): simplify dashboard around action items"
```

### Task 3: Persistent Settings App Shell

**Files:**
- Modify: `app/settings/layout.tsx`
- Modify: `tests/dashboard-ui-contracts.test.ts`

**Interfaces:**
- Consumes: `getAppShellContext(tenantId)`, `AppRail`, `AskFlowDeskPanel`, existing Settings content.
- Produces: authenticated desktop rail shell and unchanged mobile Settings content.

- [ ] **Step 1: Add a failing Settings shell contract test**

```ts
it("settings routes render inside the shared desktop app shell", () => {
  const layout = source("app/settings/layout.tsx")
  expect(layout).toContain("getServerSession")
  expect(layout).toContain("getAppShellContext")
  expect(layout).toContain("AppRail")
  expect(layout).toContain("AskFlowDeskPanel")
  expect(layout).toContain("hidden lg:flex lg:h-screen")
  expect(layout).toContain("lg:hidden")
})
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `npm test -- tests/dashboard-ui-contracts.test.ts`

Expected: FAIL because Settings does not yet import/render the app shell.

- [ ] **Step 3: Implement the Assistant-style Settings shell**

```tsx
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")
  const { needsReplyCount, pendingApprovals } = await getAppShellContext(tenantId)
  return <>
    <div className="hidden lg:flex lg:h-screen">
      <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
      <div className="flex flex-1 flex-col overflow-y-auto bg-slate-50"><SettingsContent>{children}</SettingsContent></div>
    </div>
    <div className="min-h-screen bg-slate-50 lg:hidden"><SettingsContent>{children}</SettingsContent></div>
    <AskFlowDeskPanel />
  </>
}
```

- [ ] **Step 4: Run focused Settings/dashboard tests and confirm GREEN**

Run: `npm test -- tests/dashboard-ui-contracts.test.ts tests/settings-tabs.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Settings shell**

```bash
git add app/settings/layout.tsx tests/dashboard-ui-contracts.test.ts
git commit -m "fix(settings): keep app rail visible"
```

### Task 4: Regression and Visual Verification

**Files:**
- Modify only files required by failures discovered in this task.
- Update: `docs/CURRENT_STATE.md`

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: verified phase-1 behavior and current-state documentation.

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit 0 with no ESLint errors.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: exit 0 and successful Next.js production build.

- [ ] **Step 4: Start the app and visually verify authenticated Home/Settings**

Run: `npm run dev`

Verify desktop and mobile widths for `/home`, `/settings/connect`, and `/settings/automation`; confirm console has no new errors, queue actions remain usable, Settings rail persists on desktop, and Settings is active.

- [ ] **Step 5: Document the shipped behavior**

Add a concise dated/current-state entry describing the action-first Home feed, exact metrics, deduplication, and persistent Settings shell.

- [ ] **Step 6: Run documentation diff checks and commit**

Run: `git diff --check`

Expected: no whitespace errors.

```bash
git add docs/CURRENT_STATE.md
git commit -m "docs: record action-first dashboard"
```
