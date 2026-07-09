# FlowDesk Inbox Redesign — Phases 1-3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure FlowDesk's nav to a 7-item rail with an expanded collapsible sidebar, convert `/mail` to full-width rows with top category tabs, surface AI rules under a first-class `/assistant` area, and split `/clean-inbox` into Bulk Archive / Bulk Unsubscribe / Analytics — all without schema changes, reusing existing endpoints and components.

**Architecture:** Builds on the shipped web-app-revamp shell (`/home`, `/mail`, `/settings/*` tabs, `AskFlowDeskPanel`). Adds one new shared chrome piece (`AppSidebar`, rendered next to `AppRail` on pages with sub-navigation) and three new route trees (`/assistant/*`, two new `/clean-inbox/*` subroutes, `/tools`) that reuse existing panel components and API routes verbatim. `/mail`'s desktop list is rebuilt as full-width rows by extracting `AppListColumn`'s query+mapping into a shared, exported helper so both the old compact list type and the new table share one source of truth for `InboxListItem`.

**Tech Stack:** Next.js 14 App Router (server components + `redirect()`), React, Tailwind, Prisma, NextAuth, Vitest (`tests/**/*.test.ts`, node env).

**Rollout:** 5 sequential slices, each its own commit (all on this task's single worktree branch `inbox-redesign-phase1-3`, per `CLAUDE.md`). Run `npm test && npx tsc --noEmit && npm run lint && npm run build` before considering any slice done. If `tsc` errors in `lib/outlook-*.ts` or `geist` imports, run `npm install && npx prisma generate` first.

---

## File Structure

**Slice 1 — Nav model + rail + sidebar shell**
- Modify: `lib/app-navigation.ts` — 7-item `PRIMARY_NAV`.
- Modify: `tests/app-navigation.test.ts` — lock the new 7-item contract.
- Modify: `app/components/AppRail.tsx` — 7 rail items in new order.
- Create: `lib/app-sidebar.ts` — pure sidebar section model (which sub-links show per rail section).
- Create: `tests/app-sidebar.test.ts`.
- Create: `app/components/AppSidebar.tsx` — collapsible sidebar client component.

**Slice 2 — Full-width Mail rows**
- Modify: `app/components/AppListColumn.tsx` — export `fetchInboxListItems()` helper.
- Create: `app/components/MailTopTabs.tsx` — URL-driven top category tabs.
- Create: `lib/mail-top-tabs.ts` — pure tab model (which `WorkflowStatus`/`emailType` maps to which tab).
- Create: `tests/mail-top-tabs.test.ts`.
- Create: `app/components/MailInboxRow.tsx` — full-width row.
- Create: `app/components/MailInboxTable.tsx` — table wrapper + empty state.
- Modify: `app/mail/page.tsx` — desktop branch renders `AppSidebar` + `MailTopTabs` + `MailInboxTable` instead of `DesktopResizablePanels` + `AppListColumn`.

**Slice 3 — Assistant area**
- Create: `lib/assistant-tabs.ts` — tab metadata (parallel to `lib/settings-tabs.ts`).
- Create: `tests/assistant-tabs.test.ts`.
- Create: `app/assistant/layout.tsx` — shared header + tab nav (parallel to `app/settings/layout.tsx`).
- Create: `app/assistant/AssistantTabNav.tsx` (parallel to `app/settings/SettingsTabNav.tsx`).
- Create: `app/assistant/page.tsx` — `redirect("/assistant/rules")`.
- Create: `app/assistant/rules/page.tsx` — reuses `SenderRulesPanel`.
- Create: `app/assistant/test-rules/page.tsx` — dry-run UI.
- Create: `app/assistant/history/page.tsx` — rule version/audit history.
- Create: `app/assistant/settings/page.tsx` — reuses `TrainAgentPanel`.
- Modify: `app/settings/training/page.tsx` — add a banner linking to `/assistant`.

**Slice 4 — Cleanup split**
- Create: `lib/cleanup-tabs.ts` — tab metadata.
- Create: `tests/cleanup-tabs.test.ts`.
- Create: `app/clean-inbox/CleanupTabNav.tsx`.
- Modify: `app/clean-inbox/page.tsx` — relabel as "Bulk Archive", render `CleanupTabNav`.
- Create: `app/clean-inbox/unsubscribe/page.tsx` — same query, filtered to `hasUnsubscribe`.
- Create: `app/clean-inbox/analytics/page.tsx` — counts by sender/domain/content type.

**Slice 5 — Tools placeholder**
- Create: `app/tools/page.tsx`.

---

## Slice 1 — Navigation model + rail + sidebar shell

Branch/commit prefix: `feat(nav): ...`. This slice is pure/UI-only, no data changes.

### Task 1.1: Lock the 7-item nav contract with a test

**Files:**
- Modify: `tests/app-navigation.test.ts`
- Modify: `lib/app-navigation.ts`

- [ ] **Step 1: Update the failing test**

Replace the `"primary navigation"` describe block in `tests/app-navigation.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { getPrimaryNav, getInboxNavigation } from "@/lib/app-navigation"

describe("primary navigation", () => {
  it("has exactly the 7 primary destinations in order", () => {
    const nav = getPrimaryNav()
    expect(nav.map((i) => i.href)).toEqual([
      "/home",
      "/mail",
      "/assistant",
      "/approvals",
      "/clean-inbox",
      "/tools",
      "/settings",
    ])
  })

  it("does not include deleted or demoted routes", () => {
    const hrefs = getPrimaryNav().map((i) => i.href)
    expect(hrefs).not.toContain("/digest")
    expect(hrefs).not.toContain("/search")
    expect(hrefs).not.toContain("/tasks")
    expect(hrefs).not.toContain("/chat")
  })
})

describe("getInboxNavigation (mobile header)", () => {
  it("omits the Sales cluster for personal accounts", () => {
    const nav = getInboxNavigation({ salesCrm: false })
    const all = [...nav.primary, ...nav.secondary].map((i) => i.href)
    expect(all).not.toContain("/leads")
    expect(all).not.toContain("/reports")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app-navigation.test.ts`
Expected: FAIL — `getPrimaryNav()` still returns the 5-item array.

- [ ] **Step 3: Update `lib/app-navigation.ts`**

Replace the `PRIMARY_NAV` constant (keep `SECONDARY_NAV`, `SALES_CRM_SECONDARY`, `getPrimaryNav`, `getInboxNavigation` as-is — only the array contents change):

```ts
/**
 * The 7 primary destinations shown in the desktop rail and mobile nav.
 * Assistant surfaces AI rules (previously buried in Settings > Training).
 * Approvals keeps its own slot — a trust-critical surface, not folded into
 * Mail's sidebar. Tools is a placeholder landing page for now.
 */
const PRIMARY_NAV: AppNavigationItem[] = [
  { label: "Home", href: "/home" },
  { label: "Mail", href: "/mail" },
  { label: "Assistant", href: "/assistant" },
  { label: "Approvals", href: "/approvals" },
  { label: "Clean", href: "/clean-inbox" },
  { label: "Tools", href: "/tools" },
  { label: "Settings", href: "/settings" },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app-navigation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/app-navigation.ts tests/app-navigation.test.ts
git commit -m "feat(nav): 7-item primary navigation model"
```

### Task 1.2: Rebuild the desktop rail for the 7-item order

**Files:**
- Modify: `app/components/AppRail.tsx`

- [ ] **Step 1: Update `RAIL_CONFIG`.** `AppRail.tsx` currently keys `RAIL_CONFIG` by href with a badge/isActive closure per item, and splits `topItems = primary.slice(0, -1)` / `bottomItems = primary.slice(-1)` (Settings pinned below a spacer). Keep that split logic as-is (Settings is still last in `PRIMARY_NAV`, so it stays pinned automatically) and add two new entries to `RAIL_CONFIG` for `/assistant` and `/clean-inbox` (Clean already exists — verify its key is `/clean-inbox` not `/clean`) and `/tools`:

```tsx
"/assistant": {
  label: "Assistant",
  icon: AssistantIcon,
  isActive: (p) => p === "/assistant" || p.startsWith("/assistant/"),
},
"/tools": {
  label: "Tools",
  icon: ToolsIcon,
  isActive: (p) => p === "/tools" || p.startsWith("/tools/"),
},
```

No badge on either — Assistant and Tools have no pending-count concept today. Add two new inline SVG icon components at the bottom of the file, matching the existing style of `HomeIcon`/`MailIcon`/etc. (24x24 viewBox, `currentColor` stroke, no fill):

```tsx
function AssistantIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a5 5 0 0 0-5 5v2a5 5 0 0 0 3 4.58V17a2 2 0 0 0 4 0v-2.42A5 5 0 0 0 17 10V8a5 5 0 0 0-5-5Z" />
      <path d="M9 21h6" />
    </svg>
  )
}

function ToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m14.7 6.3 3 3-7.4 7.4a2 2 0 0 1-1.2.6l-2.4.3.3-2.4a2 2 0 0 1 .6-1.2l7.1-7.1Z" />
      <path d="M17 3.5 20.5 7l-1.8 1.8-3.5-3.5Z" />
    </svg>
  )
}
```

- [ ] **Step 2: Verify `getPrimaryNav()` still drives rendering only** — no other file in `AppRail.tsx` hard-codes the 5-item array (confirm via `grep -n '"/home"\|"/mail"\|"/approvals"\|"/clean-inbox"\|"/settings"' app/components/AppRail.tsx` — only `RAIL_CONFIG` keys should match, not a separate ordering array).

- [ ] **Step 3: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/AppRail.tsx
git commit -m "feat(nav): rail shows 7 primary destinations (adds Assistant, Tools)"
```

### Task 1.3: Pure sidebar section model + test

**Files:**
- Create: `lib/app-sidebar.ts`
- Create: `tests/app-sidebar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/app-sidebar.test.ts
import { describe, it, expect } from "vitest"
import { getSidebarSection } from "@/lib/app-sidebar"

describe("getSidebarSection", () => {
  it("returns the Mail section for /mail and /conversations/*", () => {
    const mail = getSidebarSection("/mail")
    expect(mail?.title).toBe("Mail")
    expect(mail?.items.map((i) => i.label)).toEqual([
      "Inbox", "Needs Reply", "Waiting On", "Read Later", "Done", "Drafts", "Sent",
    ])
    expect(getSidebarSection("/conversations/abc123")?.title).toBe("Mail")
  })

  it("returns the Assistant section for /assistant/*", () => {
    const section = getSidebarSection("/assistant/rules")
    expect(section?.title).toBe("Assistant")
    expect(section?.items.map((i) => i.href)).toEqual([
      "/assistant/rules", "/assistant/test-rules", "/assistant/history", "/assistant/settings",
    ])
  })

  it("returns the Cleanup section for /clean-inbox and its subroutes", () => {
    const section = getSidebarSection("/clean-inbox/unsubscribe")
    expect(section?.title).toBe("Cleanup")
    expect(section?.items.map((i) => i.href)).toEqual([
      "/clean-inbox", "/clean-inbox/unsubscribe", "/clean-inbox/analytics",
    ])
  })

  it("returns the Tools section for /tools", () => {
    expect(getSidebarSection("/tools")?.title).toBe("Tools")
  })

  it("returns null for pages without sub-navigation", () => {
    expect(getSidebarSection("/home")).toBeNull()
    expect(getSidebarSection("/approvals")).toBeNull()
    expect(getSidebarSection("/settings")).toBeNull()
    expect(getSidebarSection("/settings/connect")).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app-sidebar.test.ts`
Expected: FAIL — `lib/app-sidebar.ts` does not exist.

- [ ] **Step 3: Create `lib/app-sidebar.ts`**

```ts
export type AppSidebarItem = {
  label: string
  href: string
}

export type AppSidebarSection = {
  title: string
  items: AppSidebarItem[]
}

const MAIL_SECTION: AppSidebarSection = {
  title: "Mail",
  items: [
    { label: "Inbox", href: "/mail" },
    { label: "Needs Reply", href: "/mail?tab=needs_reply" },
    { label: "Waiting On", href: "/mail?tab=waiting_on" },
    { label: "Read Later", href: "/mail?tab=read_later" },
    { label: "Done", href: "/mail?status=closed" },
    { label: "Drafts", href: "/mail?tab=drafts" },
    { label: "Sent", href: "/mail?tab=sent" },
  ],
}

const ASSISTANT_SECTION: AppSidebarSection = {
  title: "Assistant",
  items: [
    { label: "Rules", href: "/assistant/rules" },
    { label: "Test Rules", href: "/assistant/test-rules" },
    { label: "History", href: "/assistant/history" },
    { label: "Settings", href: "/assistant/settings" },
  ],
}

const CLEANUP_SECTION: AppSidebarSection = {
  title: "Cleanup",
  items: [
    { label: "Bulk Archive", href: "/clean-inbox" },
    { label: "Bulk Unsubscribe", href: "/clean-inbox/unsubscribe" },
    { label: "Analytics", href: "/clean-inbox/analytics" },
  ],
}

const TOOLS_SECTION: AppSidebarSection = {
  title: "Tools",
  items: [],
}

/**
 * Which expanded-sidebar section (if any) applies to the given pathname.
 * Returns null for pages that render their own sub-navigation (Settings)
 * or have none (Home, Approvals).
 */
export function getSidebarSection(pathname: string): AppSidebarSection | null {
  if (pathname === "/mail" || pathname.startsWith("/mail?") || pathname.startsWith("/conversations/")) {
    return MAIL_SECTION
  }
  if (pathname === "/assistant" || pathname.startsWith("/assistant/")) {
    return ASSISTANT_SECTION
  }
  if (pathname === "/clean-inbox" || pathname.startsWith("/clean-inbox/")) {
    return CLEANUP_SECTION
  }
  if (pathname === "/tools" || pathname.startsWith("/tools/")) {
    return TOOLS_SECTION
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app-sidebar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/app-sidebar.ts tests/app-sidebar.test.ts
git commit -m "feat(nav): pure sidebar section model"
```

### Task 1.4: Collapsible `AppSidebar` component

**Files:**
- Create: `app/components/AppSidebar.tsx`

- [ ] **Step 1: Create the component.** Follows the exact localStorage persistence pattern used in `app/components/DesktopResizablePanels.tsx` (read-on-mount gate before writing, so the collapsed default never clobbers a stored value before it's read):

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { getSidebarSection } from "@/lib/app-sidebar"

const STORAGE_KEY = "flowdesk.appSidebar.collapsed"

export default function AppSidebar() {
  const pathname = usePathname()
  const section = getSidebarSection(pathname ?? "")
  const [collapsed, setCollapsed] = useState(false)
  const [hasLoadedStored, setHasLoadedStored] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === "true") setCollapsed(true)
    } catch {
      // localStorage unavailable — fall back to expanded
    }
    setHasLoadedStored(true)
  }, [])

  useEffect(() => {
    if (!hasLoadedStored) return
    try {
      window.localStorage.setItem(STORAGE_KEY, String(collapsed))
    } catch {
      // ignore write failures (private browsing, quota)
    }
  }, [collapsed, hasLoadedStored])

  if (!section) return null

  return (
    <aside
      className={`hidden shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col ${
        collapsed ? "w-12" : "w-52"
      } transition-[width] duration-150`}
    >
      <div className="flex items-center justify-between px-3 py-3">
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {section.title}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>
      {section.items.length > 0 && (
        <nav className="flex flex-col gap-0.5 px-2 pb-3">
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className="truncate rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {collapsed ? item.label.slice(0, 1) : item.label}
            </Link>
          ))}
        </nav>
      )}
      {section.items.length === 0 && !collapsed && (
        <p className="px-3 text-sm text-slate-400">Coming soon</p>
      )}
    </aside>
  )
}
```

Active-item highlighting is intentionally left minimal (no `aria-current` state) in this task — Task 2.7 wires exact-match highlighting once `MailTopTabs`' `tab` query param exists, so the highlight logic isn't guessing at a param that doesn't exist yet.

- [ ] **Step 2: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (This component isn't imported anywhere yet — Slice 2 wires it into `/mail`; Slices 3-4 wire it into `/assistant` and `/clean-inbox`.)

- [ ] **Step 3: Commit**

```bash
git add app/components/AppSidebar.tsx
git commit -m "feat(nav): collapsible AppSidebar shell"
```

> **Note:** `AppSidebar` renders `null` on every current route until Slices 2-4 add pages under `/assistant` and `/clean-inbox/*`, and until Slice 2 wires it into `/mail`. Verify slice 1 by loading `/mail` and confirming nothing visually changes yet (sidebar isn't mounted there until Slice 2), and that `/assistant`/`/tools` 404 (expected — not built until later slices).

---

## Slice 2 — Full-width Mail rows

Branch/commit prefix: `feat(mail): ...`.

### Task 2.1: Extract a shared `fetchInboxListItems()` helper from `AppListColumn`

**Files:**
- Modify: `app/components/AppListColumn.tsx`

- [ ] **Step 1: Export the existing internal query+mapping logic.** `AppListColumn.tsx` currently has an internal `getCachedListData` (the `unstable_cache`-wrapped Prisma query) and an inline `.map()` that builds `InboxListItem[]` from `ConvRow[]`, both used only inside the default-exported `AppListColumn` component. Change `getCachedListData` and the row-mapping function to named exports so `MailInboxTable` (Task 2.5) can reuse the exact same query and mapping — do not duplicate the Prisma query or the `deriveWorkflowStatus`/label lookups in a second file. Rename the mapping block into its own exported function:

```ts
// near the top of app/components/AppListColumn.tsx, alongside the existing
// getCachedListData definition — export it instead of leaving it file-local:
export { getCachedListData }

// wrap the existing inline `listItems = displayConversations.map((conv) => {...})`
// block (lines ~265-311) in a named, exported function taking the same `conv`
// shape it already destructures:
export function mapConversationRowToListItem(conv: ConvRow): InboxListItem {
  // body unchanged — move the exact existing map-callback code here verbatim
}
```

Update the component body to call `displayConversations.map(mapConversationRowToListItem)` in place of the inline arrow function. Also export the `ConvRow` type (currently file-local) since `mapConversationRowToListItem`'s signature needs it:

```ts
export type ConvRow = {
  // unchanged — just add `export` to the existing type declaration
}
```

- [ ] **Step 2: Verify nothing else in the file broke.** `AppListColumn`'s own render path must still call `getCachedListData` and `mapConversationRowToListItem` exactly as before — this step only adds `export` keywords and lifts one inline function to a named one; it changes no behavior.

Run: `npx tsc --noEmit`
Expected: no errors — `AppListColumn`'s existing render output is unchanged.

- [ ] **Step 3: Run the full test suite to confirm no regression.**

Run: `npx vitest run`
Expected: PASS (no test currently covers `AppListColumn` directly, but any downstream test relying on `/mail` rendering must still pass).

- [ ] **Step 4: Commit**

```bash
git add app/components/AppListColumn.tsx
git commit -m "refactor(mail): export AppListColumn's query+mapping for reuse"
```

### Task 2.2: Pure top-tabs model + test

**Files:**
- Create: `lib/mail-top-tabs.ts`
- Create: `tests/mail-top-tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mail-top-tabs.test.ts
import { describe, it, expect } from "vitest"
import { MAIL_TOP_TABS, matchesMailTopTab } from "@/lib/mail-top-tabs"

describe("MAIL_TOP_TABS", () => {
  it("defines the six tabs in order", () => {
    expect(MAIL_TOP_TABS.map((t) => t.value)).toEqual([
      "important", "needs_reply", "waiting_on", "read_later", "other", "calendar",
    ])
  })
})

describe("matchesMailTopTab", () => {
  it("includes draft_ready under needs_reply", () => {
    expect(matchesMailTopTab("needs_reply", { workflowStatus: "draft_ready", emailType: null, isVip: false })).toBe(true)
  })

  it("matches needs_reply workflow status under needs_reply", () => {
    expect(matchesMailTopTab("needs_reply", { workflowStatus: "needs_reply", emailType: null, isVip: false })).toBe(true)
  })

  it("matches waiting_on and read_later by workflow status", () => {
    expect(matchesMailTopTab("waiting_on", { workflowStatus: "waiting_on", emailType: null, isVip: false })).toBe(true)
    expect(matchesMailTopTab("read_later", { workflowStatus: "read_later", emailType: null, isVip: false })).toBe(true)
  })

  it("matches calendar by emailType regardless of workflow status", () => {
    expect(matchesMailTopTab("calendar", { workflowStatus: "done", emailType: "calendar", isVip: false })).toBe(true)
  })

  it("matches important for VIP senders regardless of workflow status", () => {
    expect(matchesMailTopTab("important", { workflowStatus: "done", emailType: null, isVip: true })).toBe(true)
    expect(matchesMailTopTab("important", { workflowStatus: "needs_reply", emailType: null, isVip: false })).toBe(false)
  })

  it("matches other for done, non-calendar, non-VIP items", () => {
    expect(matchesMailTopTab("other", { workflowStatus: "done", emailType: "newsletter", isVip: false })).toBe(true)
    expect(matchesMailTopTab("other", { workflowStatus: "needs_reply", emailType: null, isVip: false })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mail-top-tabs.test.ts`
Expected: FAIL — `lib/mail-top-tabs.ts` does not exist.

- [ ] **Step 3: Create `lib/mail-top-tabs.ts`**

```ts
import type { WorkflowStatus } from "@/lib/workflow-status"

export type MailTopTabValue = "important" | "needs_reply" | "waiting_on" | "read_later" | "other" | "calendar"

export const MAIL_TOP_TABS: { value: MailTopTabValue; label: string }[] = [
  { value: "important", label: "Important" },
  { value: "needs_reply", label: "Needs Reply" },
  { value: "waiting_on", label: "Waiting On" },
  { value: "read_later", label: "Read Later" },
  { value: "other", label: "Other" },
  { value: "calendar", label: "Calendar" },
]

export type MailTopTabInput = {
  workflowStatus: WorkflowStatus
  emailType: string | null
  /** VIP/priority signal — Phase 1 computes "Important" from this only, no new persisted field. */
  isVip: boolean
}

/**
 * Does this conversation belong on the given top tab? Draft Ready
 * (workflowStatus === "draft_ready") counts under needs_reply — it still
 * needs the user's attention, per the redesign spec's Decision 4.
 */
export function matchesMailTopTab(tab: MailTopTabValue, input: MailTopTabInput): boolean {
  switch (tab) {
    case "important":
      return input.isVip
    case "needs_reply":
      return input.workflowStatus === "needs_reply" || input.workflowStatus === "draft_ready"
    case "waiting_on":
      return input.workflowStatus === "waiting_on"
    case "read_later":
      return input.workflowStatus === "read_later"
    case "calendar":
      return input.emailType === "calendar"
    case "other":
      return (
        input.workflowStatus === "done" &&
        input.emailType !== "calendar" &&
        !input.isVip
      )
    default:
      return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mail-top-tabs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mail-top-tabs.ts tests/mail-top-tabs.test.ts
git commit -m "feat(mail): pure top-tab matching model"
```

### Task 2.3: `MailTopTabs` component

**Files:**
- Create: `app/components/MailTopTabs.tsx`

- [ ] **Step 1: Create the component.** URL-driven via the `tab` search param (additive to `/mail`'s existing `status`/`q`/`attention`/`type`/`page` params — this task only adds `tab`, it doesn't touch the others):

```tsx
import Link from "next/link"
import { MAIL_TOP_TABS, type MailTopTabValue } from "@/lib/mail-top-tabs"

type Props = {
  activeTab: MailTopTabValue | null
  counts: Record<MailTopTabValue, number>
  /** Other active search params to preserve when switching tabs (e.g. q). */
  preserveQuery?: Record<string, string | undefined>
}

export default function MailTopTabs({ activeTab, counts, preserveQuery }: Props) {
  const baseParams = new URLSearchParams(
    Object.entries(preserveQuery ?? {}).filter(([, v]) => v != null) as [string, string][],
  )

  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-4">
      {MAIL_TOP_TABS.map((tab) => {
        const params = new URLSearchParams(baseParams)
        params.set("tab", tab.value)
        const isActive = activeTab === tab.value
        return (
          <Link
            key={tab.value}
            href={`/mail?${params.toString()}`}
            aria-current={isActive ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              isActive
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
            {counts[tab.value] > 0 && (
              <span className="ml-1.5 text-xs text-slate-400">{counts[tab.value]}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Verify types.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/MailTopTabs.tsx
git commit -m "feat(mail): MailTopTabs component"
```

### Task 2.4: `MailInboxRow` — full-width row

**Files:**
- Create: `app/components/MailInboxRow.tsx`

- [ ] **Step 1: Create the component.** Reuses `InboxRowWithSnooze`'s hover-action behavior by composing it rather than reimplementing fetch calls — `MailInboxRow` is a full-width visual wrapper around the same `InboxListItem` shape, delegating actions to `InboxRowWithSnooze` so the existing `/api/conversations/[id]/*` endpoints stay the single call sites:

```tsx
import type { InboxListItem } from "@/app/components/ClientFilteredInboxList"
import InboxRowWithSnooze from "@/app/components/InboxRowWithSnooze"

type Props = Omit<InboxListItem, "isSelected"> & { isSelected?: boolean }

/**
 * Full-width horizontal row for the Mail table. Delegates all hover actions
 * (read/unread, status, snooze, archive, done/reopen) to InboxRowWithSnooze /
 * InboxRow so no API call site is duplicated — this component only changes
 * layout (full-width sender/subject/snippet/timestamp columns) via a wrapper
 * className, not behavior.
 */
export default function MailInboxRow(props: Props) {
  return (
    <div className="w-full border-b border-slate-100 last:border-b-0">
      <InboxRowWithSnooze {...props} isSelected={props.isSelected ?? false} />
    </div>
  )
}
```

- [ ] **Step 2: Verify types.**

Run: `npx tsc --noEmit`
Expected: no errors — `InboxRowWithSnooze`'s prop type (per the research report, "same prop type minus `onSnooze`") must accept `InboxListItem`'s fields directly; if `tsc` reports a mismatch, check `InboxRowWithSnooze.tsx`'s exact prop type name and adjust the `Omit<...>` here to match it instead of `InboxListItem` if they've diverged.

- [ ] **Step 3: Commit**

```bash
git add app/components/MailInboxRow.tsx
git commit -m "feat(mail): full-width MailInboxRow wrapping existing row actions"
```

### Task 2.5: `MailInboxTable` — full-width table wrapper

**Files:**
- Create: `app/components/MailInboxTable.tsx`

- [ ] **Step 1: Create the component.** Client-side, takes pre-fetched `InboxListItem[]` (fetched server-side in `app/mail/page.tsx` via the Task 2.1 exports) and renders `MailInboxRow` per item with an empty state:

```tsx
"use client"

import type { InboxListItem } from "@/app/components/ClientFilteredInboxList"
import MailInboxRow from "@/app/components/MailInboxRow"

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
        <MailInboxRow key={item.id} {...item} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify types.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/MailInboxTable.tsx
git commit -m "feat(mail): MailInboxTable full-width list wrapper"
```

### Task 2.6: Wire `AppSidebar` + `MailTopTabs` + `MailInboxTable` into `/mail`'s desktop branch

**Files:**
- Modify: `app/mail/page.tsx`

- [ ] **Step 1: Add the `tab` search param.** Extend `Props.searchParams` to include `tab?: string` alongside the existing `status`, `q`, `sales`, `attention`, `type`, `page`.

- [ ] **Step 2: Fetch list items using the Task 2.1 exports.** In the desktop branch, replace the `<DesktopResizablePanels ... left={<AppListColumn .../>} main={<placeholder>} />` block with a direct call to `getCachedListData` + `.map(mapConversationRowToListItem)` (imported from `@/app/components/AppListColumn`), matching the exact `tenantId`/`status`/`contentType`/`q` arguments `AppListColumn` itself already computes earlier in this same file (the existing `status`, `q`, `type` searchParams parsing in `app/mail/page.tsx` already produces these values for the params `AppListColumn` currently receives as props — reuse those same local variables, don't recompute them).

- [ ] **Step 3: Filter by the new `tab` param.** After mapping to `InboxListItem[]`, if `searchParams.tab` is a valid `MailTopTabValue`, filter using `matchesMailTopTab` (from `@/lib/mail-top-tabs`) — this needs each item's `emailType`, `isVip`. `InboxListItem` (per the research report) already carries `attentionCategory`, `isVip?`, and `workflowStatus`; `emailType`/`contentType` is present as `contentType` on `InboxListItem` — pass `{ workflowStatus: item.workflowStatus, emailType: item.contentType ?? null, isVip: item.isVip ?? false }` to `matchesMailTopTab`.

- [ ] **Step 4: Compute per-tab counts.** Before filtering, compute `counts: Record<MailTopTabValue, number>` by running `matchesMailTopTab` for every tab against the full (unfiltered-by-tab) `InboxListItem[]`, so `MailTopTabs` can show live counts that don't shift as you switch tabs.

- [ ] **Step 5: Render the new desktop layout.**

```tsx
<div className="hidden lg:flex lg:h-screen">
  <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
  <AppSidebar />
  <div className="flex flex-1 flex-col overflow-hidden">
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <h1 className="text-lg font-semibold text-slate-900">Mail</h1>
      <SearchInput defaultValue={searchParams.q} />
    </div>
    <MailTopTabs
      activeTab={isValidMailTopTab(searchParams.tab) ? searchParams.tab : null}
      counts={tabCounts}
      preserveQuery={{ q: searchParams.q }}
    />
    <MailInboxTable items={filteredItems} emptyMessage="No conversations match this view." />
  </div>
</div>
```

Import `AppSidebar` from `@/app/components/AppSidebar`, `MailTopTabs` from `@/app/components/MailTopTabs`, `MailInboxTable` from `@/app/components/MailInboxTable`, and add a small local type guard:

```ts
import { MAIL_TOP_TABS, matchesMailTopTab, type MailTopTabValue } from "@/lib/mail-top-tabs"

function isValidMailTopTab(value: string | undefined): value is MailTopTabValue {
  return MAIL_TOP_TABS.some((t) => t.value === value)
}
```

- [ ] **Step 6: Remove now-unused desktop-branch imports.** `DesktopResizablePanels` and the direct `<AppListColumn .../>` render are no longer used in the desktop branch — remove the import if nothing else in the file references them (the mobile branch, per the research report, has its own inline query and does not import `AppListColumn`, so this import likely becomes fully unused; confirm with `grep -n "DesktopResizablePanels\|AppListColumn" app/mail/page.tsx` before deleting).

- [ ] **Step 7: Preserve existing search params.** `status`, `sales`, `attention`, `type`, `page` must still filter the underlying query exactly as before Task 2.6 — this task only adds tab-based post-filtering on top of the existing server-side query, it doesn't remove any existing filter.

- [ ] **Step 8: Verify types + lint + build.**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 9: Manual verification (dev server).** Start the app, log in, visit `/mail`:
  - Full-width rows render with sender/subject/snippet/timestamp and hover actions.
  - Top tabs (Important/Needs Reply/Waiting On/Read Later/Other/Calendar) filter the list; counts shown.
  - `AppSidebar`'s Mail section links (`?tab=needs_reply` etc.) match what clicking the top tabs produces.
  - Existing `?status=`, `?q=`, `?type=` links (e.g. from `ReadLaterSection`, `QuietlyHandledBanner`) still filter correctly.
  - Clicking a row navigates to `/conversations/[id]`; hover actions (archive, snooze, mark done) still work and call the same endpoints as before (verify via Network tab: `PATCH /api/conversations/[id]/*`).
  - Mobile `/mail` (resize viewport) is visually unchanged from before this slice.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(mail): full-width rows + top category tabs + sidebar on /mail desktop"
```

---

## Slice 3 — Assistant area

Branch/commit prefix: `feat(assistant): ...`.

### Task 3.1: Assistant tab metadata + test

**Files:**
- Create: `lib/assistant-tabs.ts`
- Create: `tests/assistant-tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/assistant-tabs.test.ts
import { describe, it, expect } from "vitest"
import { ASSISTANT_TABS } from "@/lib/assistant-tabs"

describe("assistant tabs", () => {
  it("defines the four tabs in order", () => {
    expect(ASSISTANT_TABS.map((t) => t.slug)).toEqual([
      "rules", "test-rules", "history", "settings",
    ])
  })
  it("gives every tab a route under /assistant", () => {
    for (const t of ASSISTANT_TABS) expect(t.href).toBe(`/assistant/${t.slug}`)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run tests/assistant-tabs.test.ts`).

- [ ] **Step 3: Create `lib/assistant-tabs.ts`** (mirrors `lib/settings-tabs.ts`'s exact shape):

```ts
export type AssistantTab = { slug: string; label: string; description: string; href: string }

const TABS: Omit<AssistantTab, "href">[] = [
  { slug: "rules", label: "Rules", description: "Active, draft, and learned rules" },
  { slug: "test-rules", label: "Test Rules", description: "Dry-run a rule before enabling it" },
  { slug: "history", label: "History", description: "Rule versions and audit events" },
  { slug: "settings", label: "Settings", description: "Plain-English training" },
]

export const ASSISTANT_TABS: AssistantTab[] = TABS.map((t) => ({ ...t, href: `/assistant/${t.slug}` }))
```

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/assistant-tabs.ts tests/assistant-tabs.test.ts
git commit -m "feat(assistant): tab metadata"
```

### Task 3.2: Assistant layout + tab nav

**Files:**
- Create: `app/assistant/layout.tsx`
- Create: `app/assistant/AssistantTabNav.tsx`

- [ ] **Step 1: Create `app/assistant/AssistantTabNav.tsx`** — copy `app/settings/SettingsTabNav.tsx`'s exact structure (sticky aside, bordered card nav, `aria-current`/highlight on active), swapping the data source and the path-segment index (Assistant routes are `/assistant/<slug>`, same depth as `/settings/<slug>`, so the segment index stays `pathname.split("/")[2]`):

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ASSISTANT_TABS } from "@/lib/assistant-tabs"

export default function AssistantTabNav() {
  const pathname = usePathname()
  const segment = pathname?.split("/")[2] ?? ""

  return (
    <aside className="lg:sticky lg:top-4">
      <nav className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Assistant
        </p>
        <div className="grid gap-1">
          {ASSISTANT_TABS.map((tab) => {
            const isActive = segment === tab.slug
            return (
              <Link
                key={tab.slug}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-lg px-2 py-2 ${isActive ? "bg-slate-100" : "hover:bg-slate-50"}`}
              >
                <div className="text-sm font-medium text-slate-900">{tab.label}</div>
                <div className="text-xs text-slate-500">{tab.description}</div>
              </Link>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}
```

- [ ] **Step 2: Create `app/assistant/layout.tsx`** — copy `app/settings/layout.tsx`'s exact header/back-link/grid structure, swapping `SettingsTabNav` for `AssistantTabNav` and the header copy:

```tsx
import type { ReactNode } from "react"
import Link from "next/link"
import AssistantTabNav from "@/app/assistant/AssistantTabNav"

export default function AssistantLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/home" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to control room
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Assistant</h1>
        <p className="text-sm text-slate-500">Rules the agent uses to triage and act on your inbox.</p>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <AssistantTabNav />
        <div className="space-y-10">{children}</div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Verify types.**

Run: `npx tsc --noEmit`
Expected: no errors. (No page exists under `/assistant` yet — that's Task 3.3+.)

- [ ] **Step 4: Commit**

```bash
git add app/assistant/layout.tsx app/assistant/AssistantTabNav.tsx
git commit -m "feat(assistant): shared layout + tab nav"
```

### Task 3.3: `/assistant` redirect + `/assistant/rules`

**Files:**
- Create: `app/assistant/page.tsx`
- Create: `app/assistant/rules/page.tsx`

- [ ] **Step 1: Create `app/assistant/page.tsx`**

```tsx
import { redirect } from "next/navigation"

export default function AssistantIndex() {
  redirect("/assistant/rules")
}
```

- [ ] **Step 2: Create `app/assistant/rules/page.tsx`** — copies the auth-guard + data-fetch pattern from `app/settings/training/page.tsx` for exactly the two queries `SenderRulesPanel` needs (`senderRules`, `staticRules`), reusing the same Prisma shapes and the same `SenderRulesPanel` component with identical props:

```tsx
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import SenderRulesPanel from "@/app/settings/SenderRulesPanel"

export const dynamic = "force-dynamic"

export default async function AssistantRulesPage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const [senderRules, agentRulesRaw] = await Promise.all([
    prisma.senderRule.findMany({
      where: { tenantId, status: { in: ["suggested", "active"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentRule.findMany({
      where: { tenantId, status: { not: "dismissed" } },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const staticRules = agentRulesRaw.filter((r) => r.source === "manual")

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Rules</h2>
      <p className="mb-4 text-sm text-slate-500">
        Active, draft, and learned rules the agent uses to label and route mail.
      </p>
      <SenderRulesPanel initialRules={senderRules} initialStaticRules={staticRules} />
    </section>
  )
}
```

Verify the exact field names/status values (`"suggested"`, `"active"`, `"dismissed"`, `"manual"`) against `app/settings/training/page.tsx`'s existing query before finalizing — copy them verbatim from that file rather than retyping from memory, since the research report's summary may abbreviate exact string literals.

- [ ] **Step 3: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual check (dev server).** Visit `/assistant` → redirects to `/assistant/rules`; the same rules visible on `/settings/training` appear here; create/preview/enable/disable/remove a rule and confirm it still calls the existing `/api/agent-rules*` and `/api/sender-rules/*` endpoints (Network tab) — no new endpoint should be hit.

- [ ] **Step 5: Commit**

```bash
git add app/assistant/page.tsx app/assistant/rules/page.tsx
git commit -m "feat(assistant): /assistant redirect + Rules tab"
```

### Task 3.4: `/assistant/test-rules`

**Files:**
- Create: `app/assistant/test-rules/page.tsx`

- [ ] **Step 1: Create the page.** The dry-run flow (`POST /api/agent-rules/dry-run`) is currently only reachable from inside `SenderRulesPanel`'s preview button, per the research report — there is no standalone dry-run UI to extract. Build a minimal client form here that posts to the existing route and renders its existing response shape (`{ ok, ruleId, ruleVersion, sampleSize, matchedCount, skippedCount, matches, plannedAction, automationLevel, wouldApplyGmailLabels }`) without inventing new fields:

```tsx
"use client"

import { useState } from "react"

type DryRunResult = {
  ok: boolean
  sampleSize: number
  matchedCount: number
  skippedCount: number
  matches: { conversationId: string; subject: string | null; senderEmail: string | null }[]
  plannedAction: unknown
  automationLevel: string
  wouldApplyGmailLabels: string[]
}

export default function AssistantTestRulesPage() {
  const [ruleId, setRuleId] = useState("")
  const [result, setResult] = useState<DryRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function runDryRun() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/agent-rules/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Dry-run failed")
        setResult(null)
      } else {
        setResult(data)
      }
    } catch {
      setError("Network error running dry-run")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Test Rules</h2>
      <p className="mb-4 text-sm text-slate-500">
        Dry-run a saved rule against your recent conversations before enabling it.
      </p>
      <div className="flex gap-2">
        <input
          value={ruleId}
          onChange={(e) => setRuleId(e.target.value)}
          placeholder="Rule ID"
          className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={runDryRun}
          disabled={!ruleId || loading}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Running…" : "Run dry-run"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            Matched {result.matchedCount} of {result.sampleSize} sampled conversations
            ({result.skippedCount} skipped).
          </p>
          <p>Automation level: {result.automationLevel}</p>
          {result.wouldApplyGmailLabels.length > 0 && (
            <p>Would apply Gmail labels: {result.wouldApplyGmailLabels.join(", ")}</p>
          )}
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {result.matches.map((m) => (
              <li key={m.conversationId} className="px-3 py-2">
                {m.subject ?? "(no subject)"} — {m.senderEmail ?? "unknown sender"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
```

Rule IDs are findable via `/assistant/rules` today (no rule picker in this task — copy-paste ID is an acceptable Phase-1 interaction, matching the spec's "avoid overbuilding" guidance).

- [ ] **Step 2: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If the actual `POST /api/agent-rules/dry-run` response shape differs from `DryRunResult` above (check `app/api/agent-rules/dry-run/route.ts` directly), adjust the type to match exactly — do not guess field names.

- [ ] **Step 3: Manual check (dev server).** Copy a rule ID from `/assistant/rules`, paste into `/assistant/test-rules`, run dry-run, confirm matched/skipped counts render and match what the existing `SenderRulesPanel` preview button shows for the same rule.

- [ ] **Step 4: Commit**

```bash
git add app/assistant/test-rules/page.tsx
git commit -m "feat(assistant): Test Rules tab"
```

### Task 3.5: `/assistant/history`

**Files:**
- Create: `app/assistant/history/page.tsx`

- [ ] **Step 1: Create the page.** Reuses the existing `GET /api/agent-rules/[id]/versions` route (per the research report, called from `SenderRulesPanel`'s history view) plus a direct `AuditLog` query scoped to rule-related actions:

```tsx
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export default async function AssistantHistoryPage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const auditEntries = await prisma.auditLog.findMany({
    where: {
      tenantId,
      action: { in: ["agent_rule.created", "agent_rule.updated", "agent_rule.status_changed", "agent_rule.deleted"] },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">History</h2>
      <p className="mb-4 text-sm text-slate-500">Rule version changes and related activity.</p>
      {auditEntries.length === 0 ? (
        <p className="text-sm text-slate-400">No rule activity yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {auditEntries.map((entry) => (
            <li key={entry.id} className="px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{entry.action}</span>{" "}
              <span className="text-slate-400">{entry.createdAt.toISOString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

Verify the exact `AuditLog.action` string literals used for rule changes by checking `app/api/agent-rules/[id]/route.ts`'s audit-write call sites before finalizing this filter — the values above are best-guess names based on the research report's description ("Snapshots old versions into AuditLog") and must be confirmed against the actual strings written, not assumed.

- [ ] **Step 2: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual check (dev server).** Change a rule's status on `/assistant/rules`, then visit `/assistant/history` and confirm the change appears.

- [ ] **Step 4: Commit**

```bash
git add app/assistant/history/page.tsx
git commit -m "feat(assistant): History tab"
```

### Task 3.6: `/assistant/settings`

**Files:**
- Create: `app/assistant/settings/page.tsx`

- [ ] **Step 1: Create the page** — reuses `TrainAgentPanel` with the same `initialRules` query `app/settings/training/page.tsx` already runs (plain-English rules: `agentRules.filter(r => r.source !== "manual")`):

```tsx
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TrainAgentPanel from "@/app/settings/TrainAgentPanel"

export const dynamic = "force-dynamic"

export default async function AssistantSettingsPage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const agentRulesRaw = await prisma.agentRule.findMany({
    where: { tenantId, status: { not: "dismissed" } },
    orderBy: { createdAt: "desc" },
  })
  const plainEnglishRules = agentRulesRaw.filter((r) => r.source !== "manual")

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Assistant Settings</h2>
      <p className="mb-4 text-sm text-slate-500">Train the agent with plain-English instructions.</p>
      <TrainAgentPanel initialRules={plainEnglishRules} />
    </section>
  )
}
```

- [ ] **Step 2: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/assistant/settings/page.tsx
git commit -m "feat(assistant): Settings tab (plain-English training)"
```

### Task 3.7: Link `/settings/training` to `/assistant` (compatibility banner)

**Files:**
- Modify: `app/settings/training/page.tsx`

- [ ] **Step 1: Add a banner at the top of the page's returned JSX**, above the existing three panel `<section>`s, following the same demote-via-link pattern the prior web-app-revamp used for Tasks/Activity:

```tsx
<div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
  Rules and training now have a dedicated home.{" "}
  <a href="/assistant" className="font-medium underline">
    Open Assistant →
  </a>
</div>
```

Do not remove any of the existing three panels — this page keeps working exactly as before, per the spec's "no functionality removed" requirement.

- [ ] **Step 2: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Full slice verification.**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add app/settings/training/page.tsx
git commit -m "feat(assistant): link Settings > Training to the new Assistant area"
```

---

## Slice 4 — Cleanup split

Branch/commit prefix: `feat(cleanup): ...`.

### Task 4.1: Cleanup tab metadata + test

**Files:**
- Create: `lib/cleanup-tabs.ts`
- Create: `tests/cleanup-tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cleanup-tabs.test.ts
import { describe, it, expect } from "vitest"
import { CLEANUP_TABS } from "@/lib/cleanup-tabs"

describe("cleanup tabs", () => {
  it("defines the three tabs in order with /clean-inbox as the Bulk Archive route", () => {
    expect(CLEANUP_TABS).toEqual([
      { slug: "archive", label: "Bulk Archive", href: "/clean-inbox" },
      { slug: "unsubscribe", label: "Bulk Unsubscribe", href: "/clean-inbox/unsubscribe" },
      { slug: "analytics", label: "Analytics", href: "/clean-inbox/analytics" },
    ])
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run tests/cleanup-tabs.test.ts`).

- [ ] **Step 3: Create `lib/cleanup-tabs.ts`**

```ts
export type CleanupTab = { slug: string; label: string; href: string }

export const CLEANUP_TABS: CleanupTab[] = [
  { slug: "archive", label: "Bulk Archive", href: "/clean-inbox" },
  { slug: "unsubscribe", label: "Bulk Unsubscribe", href: "/clean-inbox/unsubscribe" },
  { slug: "analytics", label: "Analytics", href: "/clean-inbox/analytics" },
]
```

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/cleanup-tabs.ts tests/cleanup-tabs.test.ts
git commit -m "feat(cleanup): tab metadata"
```

### Task 4.2: `CleanupTabNav` + relabel `/clean-inbox` as Bulk Archive

**Files:**
- Create: `app/clean-inbox/CleanupTabNav.tsx`
- Modify: `app/clean-inbox/page.tsx`

- [ ] **Step 1: Create `app/clean-inbox/CleanupTabNav.tsx`** — a horizontal tab strip (not the sticky-aside pattern, since Cleanup pages are already fairly full-width per the research report):

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CLEANUP_TABS } from "@/lib/cleanup-tabs"

export default function CleanupTabNav() {
  const pathname = usePathname()

  return (
    <nav className="mb-6 flex gap-1 border-b border-slate-200">
      {CLEANUP_TABS.map((tab) => {
        const isActive = pathname === tab.href
        return (
          <Link
            key={tab.slug}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              isActive ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Modify `app/clean-inbox/page.tsx`.** Add `<CleanupTabNav />` above the existing heading, and change the page heading/copy from generic "Clean Inbox" language to explicitly "Bulk Archive" (exact current heading text depends on the file — locate the `<h1>`/`<h2>` in `app/clean-inbox/page.tsx` and update its text to "Bulk Archive" while keeping the rest of the page — the `groupCleanupBySender()` call, the `<CleanInboxClient groups={groups} />` render — completely unchanged).

- [ ] **Step 3: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/clean-inbox/CleanupTabNav.tsx app/clean-inbox/page.tsx
git commit -m "feat(cleanup): relabel /clean-inbox as Bulk Archive + tab strip"
```

### Task 4.3: `/clean-inbox/unsubscribe`

**Files:**
- Create: `app/clean-inbox/unsubscribe/page.tsx`

- [ ] **Step 1: Create the page.** Copies `app/clean-inbox/page.tsx`'s exact query (same `prisma.conversation.findMany` where-clause, same `select`, same `take: 400`) and `groupCleanupBySender()` call, then filters the resulting groups to `hasUnsubscribe === true` before passing to `CleanInboxClient`:

```tsx
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { groupCleanupBySender, type CleanupCandidate } from "@/lib/agent/sender-cleanup"
import CleanInboxClient from "@/app/clean-inbox/CleanInboxClient"
import CleanupTabNav from "@/app/clean-inbox/CleanupTabNav"

export const dynamic = "force-dynamic"

export default async function BulkUnsubscribePage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      status: { not: "closed" },
      OR: [
        { stateRecord: { emailType: { in: ["newsletter", "marketing"] } } },
        { stateRecord: { attentionCategory: { in: ["quiet", "fyi_done"] } } },
      ],
    },
    select: {
      id: true,
      subject: true,
      status: true,
      userState: true,
      lastMessageAt: true,
      contact: { select: { name: true, phoneE164: true } },
      stateRecord: { select: { emailType: true, attentionCategory: true, metadataJson: true } },
    },
    take: 400,
    orderBy: { lastMessageAt: "desc" },
  })

  const candidates: CleanupCandidate[] = conversations.map((c) => {
    const meta = c.stateRecord?.metadataJson as { unsubscribeUrl?: unknown } | null
    return {
      id: c.id,
      senderEmail: c.contact?.phoneE164 ?? null,
      senderName: c.contact?.name ?? null,
      subject: c.subject,
      emailType: c.stateRecord?.emailType ?? null,
      attentionCategory: c.stateRecord?.attentionCategory ?? null,
      status: c.status,
      userState: c.userState,
      hasUnsubscribe: typeof meta?.unsubscribeUrl === "string" && meta.unsubscribeUrl.length > 0,
      lastReceivedAt: c.lastMessageAt,
    }
  })

  const groups = groupCleanupBySender(candidates)
    .filter((g) => g.hasUnsubscribe)
    .map((g) => ({
      senderEmail: g.senderEmail,
      senderName: g.senderName,
      domain: g.domain,
      count: g.count,
      sampleSubjects: g.sampleSubjects,
      conversationIds: g.conversationIds,
      hasUnsubscribe: g.hasUnsubscribe,
    }))

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">Bulk Unsubscribe</h1>
      <p className="mb-2 text-sm text-slate-500">
        Senders whose emails include a working unsubscribe link.
      </p>
      <CleanupTabNav />
      <CleanInboxClient groups={groups} />
    </main>
  )
}
```

Before finalizing, diff this query/mapping/select field-for-field against the actual `app/clean-inbox/page.tsx` (not the research report's summary) — the `select` fields, the `CleanInboxClient` group-object shape, and `CleanupCandidate`'s exact fields must match exactly what those files use today, since this task duplicates the query rather than importing a shared helper (acceptable here per YAGNI — extracting a shared query helper is only worth it if a third cleanup page needs the identical query; Task 4.4's Analytics page needs a different aggregation, so two near-identical queries is simpler than a premature abstraction for two call sites).

- [ ] **Step 2: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors — fix any field-name mismatches found in Step 1's diff.

- [ ] **Step 3: Manual check (dev server).** Visit `/clean-inbox/unsubscribe`; confirm only senders with `hasUnsubscribe: true` appear (compare against `/clean-inbox`'s full list); run "Unsubscribe + archive" on a group and confirm it calls the existing `POST /api/clean-inbox/unsubscribe-batch` (Network tab) and the undo flow still works.

- [ ] **Step 4: Commit**

```bash
git add app/clean-inbox/unsubscribe/page.tsx
git commit -m "feat(cleanup): Bulk Unsubscribe tab"
```

### Task 4.4: `/clean-inbox/analytics`

**Files:**
- Create: `app/clean-inbox/analytics/page.tsx`

- [ ] **Step 1: Create the page.** Reuses the same candidate query as Task 4.3, but aggregates by domain and content type instead of rendering `CleanInboxClient`:

```tsx
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { groupCleanupBySender, type CleanupCandidate } from "@/lib/agent/sender-cleanup"
import CleanupTabNav from "@/app/clean-inbox/CleanupTabNav"

export const dynamic = "force-dynamic"

export default async function CleanupAnalyticsPage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      status: { not: "closed" },
      OR: [
        { stateRecord: { emailType: { in: ["newsletter", "marketing"] } } },
        { stateRecord: { attentionCategory: { in: ["quiet", "fyi_done"] } } },
      ],
    },
    select: {
      id: true,
      subject: true,
      status: true,
      userState: true,
      lastMessageAt: true,
      contact: { select: { name: true, phoneE164: true } },
      stateRecord: { select: { emailType: true, attentionCategory: true, metadataJson: true } },
    },
    take: 400,
    orderBy: { lastMessageAt: "desc" },
  })

  const candidates: CleanupCandidate[] = conversations.map((c) => {
    const meta = c.stateRecord?.metadataJson as { unsubscribeUrl?: unknown } | null
    return {
      id: c.id,
      senderEmail: c.contact?.phoneE164 ?? null,
      senderName: c.contact?.name ?? null,
      subject: c.subject,
      emailType: c.stateRecord?.emailType ?? null,
      attentionCategory: c.stateRecord?.attentionCategory ?? null,
      status: c.status,
      userState: c.userState,
      hasUnsubscribe: typeof meta?.unsubscribeUrl === "string" && meta.unsubscribeUrl.length > 0,
      lastReceivedAt: c.lastMessageAt,
    }
  })

  const groups = groupCleanupBySender(candidates)

  const byDomain = new Map<string, number>()
  const byEmailType = new Map<string, number>()
  for (const candidate of candidates) {
    byEmailType.set(candidate.emailType ?? "unknown", (byEmailType.get(candidate.emailType ?? "unknown") ?? 0) + 1)
  }
  for (const group of groups) {
    byDomain.set(group.domain, (byDomain.get(group.domain) ?? 0) + group.count)
  }
  const topDomains = [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  const totalCleanable = candidates.length
  const unsubscribableCount = groups.filter((g) => g.hasUnsubscribe).reduce((sum, g) => sum + g.count, 0)

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">Cleanup Analytics</h1>
      <p className="mb-2 text-sm text-slate-500">
        {totalCleanable} cleanable conversations across {groups.length} senders,{" "}
        {unsubscribableCount} with an unsubscribe link.
      </p>
      <CleanupTabNav />
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By content type</h2>
          <ul className="space-y-1 text-sm">
            {[...byEmailType.entries()].map(([type, count]) => (
              <li key={type} className="flex justify-between">
                <span className="text-slate-600">{type}</span>
                <span className="text-slate-900">{count}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Top domains</h2>
          <ul className="space-y-1 text-sm">
            {topDomains.map(([domain, count]) => (
              <li key={domain} className="flex justify-between">
                <span className="text-slate-600">{domain}</span>
                <span className="text-slate-900">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual check (dev server).** Visit `/clean-inbox/analytics`; confirm domain/content-type counts are non-zero and roughly match what's visible browsing `/clean-inbox`'s sender groups.

- [ ] **Step 4: Full slice verification.**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/clean-inbox/analytics/page.tsx
git commit -m "feat(cleanup): Analytics tab"
```

### Task 4.5: Wire `AppSidebar` into Cleanup pages

**Files:**
- Modify: `app/clean-inbox/page.tsx`, `app/clean-inbox/unsubscribe/page.tsx`, `app/clean-inbox/analytics/page.tsx`

- [ ] **Step 1: Render `AppRail` + `AppSidebar` on all three cleanup pages**, matching the layout pattern established in Task 2.6 for `/mail` (rail + sidebar on the left, page content on the right) — check whether `app/clean-inbox/page.tsx` already renders `AppRail` today (per the research report it wasn't confirmed either way; if it does, just add `<AppSidebar />` next to it; if it doesn't, wrap the existing page content in the same flex shell `/mail` uses).

- [ ] **Step 2: Verify types + lint + build.**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual check.** `AppSidebar`'s Cleanup section (Bulk Archive / Bulk Unsubscribe / Analytics) is visible and links correctly on all three pages.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(cleanup): wire AppSidebar into cleanup pages"
```

---

## Slice 5 — Tools placeholder

Branch/commit prefix: `feat(tools): ...`.

### Task 5.1: `/tools` placeholder page

**Files:**
- Create: `app/tools/page.tsx`

- [ ] **Step 1: Create the page.** Per the spec's non-goals, this must not pretend unbuilt features work — a clearly-labeled "coming soon" page, not fake data or dead links:

```tsx
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import AppRail from "@/app/components/AppRail"
import AppSidebar from "@/app/components/AppSidebar"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

const PLANNED_TOOLS = ["Calendar", "Meeting Briefs", "Attachments"]

export default async function ToolsPage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const [needsReplyCount, pendingApprovals] = await Promise.all([
    prisma.conversation.count({ where: { tenantId, status: "needs_reply" } }),
    prisma.draft.count({ where: { conversation: { tenantId }, status: "proposed" } }),
  ])

  return (
    <div className="flex h-screen">
      <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
      <AppSidebar />
      <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Tools</h1>
        <p className="max-w-sm text-sm text-slate-500">
          {PLANNED_TOOLS.join(", ")} are planned but not built yet. Nothing here works today.
        </p>
      </main>
    </div>
  )
}
```

Before finalizing the `needsReplyCount`/`pendingApprovals` queries, check the exact query `app/mail/page.tsx` or `app/home/page.tsx` already uses for these same two counts (they're passed to `AppRail` in multiple places today) and copy the exact where-clauses from there instead of guessing — the values above (`status: "needs_reply"`, `draft.status: "proposed"`) are best-effort based on the research report and must match the existing badge-count logic exactly, or the rail badge will show a different number on `/tools` than on `/mail`.

- [ ] **Step 2: Verify types + lint + build.**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual check (dev server).** Visit `/tools` from the rail; confirm it loads, shows the coming-soon message, rail badges match other pages, and no broken links are present.

- [ ] **Step 4: Commit**

```bash
git add app/tools/page.tsx
git commit -m "feat(tools): /tools placeholder page"
```

---

## Final verification (before opening a PR)

- [ ] `npm test && npx tsc --noEmit && npm run lint && npm run build` all green.
- [ ] Manual sweep against a running dev server:
  - Rail shows exactly 7 items in order: Home, Mail, Assistant, Approvals, Cleanup, Tools, Settings.
  - `/mail` desktop: full-width rows, working top tabs with counts, sidebar Mail section, all pre-existing query params (`status`, `q`, `type`, `sales`, `attention`, `page`) still work, hover actions still hit existing endpoints, row click still opens `/conversations/[id]`.
  - `/conversations/[id]` unchanged (left list, main thread, right context panel).
  - `/assistant/rules|test-rules|history|settings` all load; rule create/dry-run/enable/disable/version-history still work via existing endpoints; draft rules still require dry-run before activation; `/settings/training` still works and now links to `/assistant`.
  - `/clean-inbox` (relabeled Bulk Archive), `/clean-inbox/unsubscribe`, `/clean-inbox/analytics` all load with a working tab strip; archive/unsubscribe/undo behavior and safety-skip rules unchanged.
  - `/tools` shows the coming-soon placeholder, not a broken page.
  - Mobile `/mail`, `/settings`, `/approvals`, `/clean-inbox` unaffected by this work.
  - `AppSidebar` collapse/expand persists across a page reload.
- [ ] `git grep -rn "DesktopResizablePanels" app/mail/page.tsx` returns nothing (or confirm it's still legitimately used elsewhere before leaving it).
- [ ] Update living docs per `docs/README.md`: reflect the new nav/IA in whatever doc currently describes the web app's route map (check `docs/CURRENT_STATE.md` / `docs/product-direction.md` for the prior revamp's equivalent updates and mirror them for this change).

---

## Self-Review (completed by plan author)

**Spec coverage:** Nav restructure (Task 1.1-1.2), sidebar (1.3-1.4), full-width Mail rows + top tabs (2.1-2.6), Assistant area with all 4 tabs (3.1-3.7), Cleanup split into Bulk Archive/Unsubscribe/Analytics (4.1-4.5), Tools placeholder (5.1). Approvals-in-rail decision reflected in Task 1.1's 7-item list. Draft Ready counted under Needs Reply reflected in `lib/mail-top-tabs.ts`'s `matchesMailTopTab`. No reading pane / keyboard shortcuts anywhere (correctly deferred). No schema changes in any task.

**Placeholder scan:** No "TBD"/"handle appropriately" phrasing. Several steps explicitly instruct the implementer to verify exact field/string names against the live source file before finalizing (Tasks 3.3, 3.5, 4.3, 5.1) rather than inventing them — this is a deliberate hedge against the research-report summary abbreviating literals, not a placeholder; each such step names exactly what to check and where.

**Type/name consistency:** `MailTopTabValue`, `matchesMailTopTab`, `MAIL_TOP_TABS` used consistently across `lib/mail-top-tabs.ts`, `MailTopTabs.tsx`, and `app/mail/page.tsx`. `InboxListItem` (from `ClientFilteredInboxList.tsx`) is the single shared row type reused by `MailInboxRow`/`MailInboxTable`/`app/mail/page.tsx` — no parallel row type invented. `getSidebarSection`/`AppSidebarSection` used consistently between `lib/app-sidebar.ts` and `AppSidebar.tsx`. `ASSISTANT_TABS`/`AssistantTab`, `CLEANUP_TABS`/`CleanupTab` mirror the existing `SETTINGS_TABS`/`SettingsTab` naming convention exactly.

**Scope check:** Single continuous plan across 5 slices, each independently committable and verifiable, matching the prior web-app-revamp plan's proven slice size. Phase 4 (reading pane, keyboard shortcuts) is explicitly out of scope per the approved design spec and not referenced in any task.
