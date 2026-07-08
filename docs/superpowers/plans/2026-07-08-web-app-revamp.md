# FlowDesk Web App Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the FlowDesk web app IA — split the crowded `/inbox` screen into a control-room Home and a dedicated Mail page, collapse navigation to 5 primary destinations, decompose Settings into route-based tabs, add a global "Ask FlowDesk" assistant slide-over, and delete dead routes — for personal accounts only.

**Architecture:** FlowDesk is Next.js 14 App Router. Today there is **no shared authenticated shell**: the nav rail (`AppRail`) is rendered per-page only on `/inbox` and `/conversations/[id]`; other pages (`/approvals`, `/settings`, `/tasks`, `/audit`, `/clean-inbox`) are standalone full pages with a "← Back to control room" header. This plan keeps that per-page pattern (no risky global-layout refactor) and instead: (1) updates the pure nav model + the rail, (2) forks the current combined `/inbox` page into `/home` (control room) and `/mail` (list + reading pane) with `/inbox` redirecting, (3) turns `/settings` into a layout + per-tab routes, (4) adds a client slide-over assistant mounted on the shell pages, (5) removes `/digest` and `/search`.

**Tech Stack:** Next.js 14 App Router (server components + `redirect()`), React, Tailwind, Prisma, NextAuth, Vitest (`tests/**/*.test.ts`, node env).

**Rollout:** 5 sequential slices, each its own branch + PR off the previous. Per `CLAUDE.md`: work only inside `.worktrees/web-revamp` (or a child worktree per slice), never commit to main, run `npm test && npx tsc --noEmit && npm run lint && npm run build` before each PR. If `tsc` errors in `lib/outlook-*.ts` or `geist` imports, run `npm install && npx prisma generate` first.

---

## File Structure

**Slice 1 — Nav model + rail**
- Modify: `lib/app-navigation.ts` — 5-item primary model, drop Digest/Tasks.
- Create: `tests/app-navigation.test.ts` — lock the nav contract.
- Modify: `app/components/AppRail.tsx` — 5 rail items + "Ask FlowDesk" trigger stub.

**Slice 2 — Home / Mail split**
- Create: `app/home/page.tsx` — control-room Home (no list).
- Create: `app/mail/page.tsx` — list + reading-pane shell (the current inbox list branch).
- Modify: `app/inbox/page.tsx` — replace with redirect logic (home view → `/home`, list/filter → `/mail`).
- Modify: `app/components/HomeCommandCenter.tsx` — remove list dependency assumptions; rename "Bills & Deadlines" → "Tasks & Deadlines" + add "View all →" link.
- Modify: `app/login/page.tsx` — `callbackUrl` `/inbox` → `/home` (2 sites).
- Modify: `app/onboarding/OnboardingFirstPass.tsx` — CTA `/inbox` → `/home` (2 sites).
- Modify: back-links `/inbox` → `/home` in `app/settings/page.tsx`, `app/tasks/page.tsx`, `app/audit/page.tsx`, `app/approvals/page.tsx`, `app/meetings/page.tsx`, `app/leads/page.tsx`, `app/reports/page.tsx`, `app/risk-radar/page.tsx`, `app/knowledge-base/page.tsx`, `app/clean-inbox/CleanInboxClient.tsx`.
- Modify: deep-link sources that point at `/inbox?...` list views → `/mail?...`: `app/components/ReadLaterSection.tsx`, `app/components/QuietlyHandledBanner.tsx`, `app/components/AppListColumn.tsx`, `app/conversations/[id]/page.tsx` (return path).

**Slice 3 — Settings tabs**
- Create: `app/settings/layout.tsx` — shared header + tab nav.
- Create: `lib/settings-tabs.ts` — tab metadata (pure, testable).
- Create: `tests/settings-tabs.test.ts`.
- Create: `app/settings/connect/page.tsx`, `app/settings/gmail/page.tsx`, `app/settings/automation/page.tsx`, `app/settings/training/page.tsx`, `app/settings/profile/page.tsx`, `app/settings/data/page.tsx` — one tab each, own data fetch.
- Modify: `app/settings/page.tsx` — becomes `redirect("/settings/connect")`.

**Slice 4 — Global assistant slide-over**
- Create: `app/components/AskFlowDeskPanel.tsx` — client slide-over reusing chat logic.
- Modify: `app/components/AppRail.tsx` — wire the trigger to open the panel.
- Modify: `app/home/page.tsx`, `app/mail/page.tsx` — mount the panel on the shell.

**Slice 5 — Deletions**
- Delete: `app/digest/` (if present), `app/search/`.
- Modify: any remaining references to `/digest` / `/search`.

---

## Slice 1 — Navigation model + rail (PR 1)

Branch: `web-revamp-nav` off `web-revamp`. Small, pure, fully unit-tested.

### Task 1.1: Lock the new nav contract with a test

**Files:**
- Create: `tests/app-navigation.test.ts`
- Modify: `lib/app-navigation.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/app-navigation.test.ts
import { describe, it, expect } from "vitest"
import { getPrimaryNav, getInboxNavigation } from "@/lib/app-navigation"

describe("primary navigation", () => {
  it("has exactly the 5 primary destinations in order", () => {
    const nav = getPrimaryNav()
    expect(nav.map((i) => i.href)).toEqual([
      "/home",
      "/mail",
      "/approvals",
      "/clean-inbox",
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

Run: `cd .worktrees/web-revamp && npx vitest run tests/app-navigation.test.ts`
Expected: FAIL — `getPrimaryNav` not exported / order mismatch.

- [ ] **Step 3: Update `lib/app-navigation.ts`**

Replace the `CONTROL_ROOM_PRIMARY`/`CONTROL_ROOM_SECONDARY` constants and add `getPrimaryNav`. The primary model is now the rail's 5 items; the mobile `getInboxNavigation` keeps its primary/secondary shape but points at the new routes and drops Digest.

```ts
// lib/app-navigation.ts — replace the two CONTROL_ROOM_* consts and add getPrimaryNav

/** The 5 primary destinations shown in the desktop rail and mobile nav. */
const PRIMARY_NAV: AppNavigationItem[] = [
  { label: "Home", href: "/home" },
  { label: "Mail", href: "/mail" },
  { label: "Approvals", href: "/approvals" },
  { label: "Clean", href: "/clean-inbox" },
  { label: "Settings", href: "/settings" },
]

/** Power-user surfaces demoted to links/menus, not primary nav. */
const SECONDARY_NAV: AppNavigationItem[] = [
  { label: "Tasks", href: "/tasks" },
  { label: "Activity", href: "/audit" },
]

export function getPrimaryNav(): AppNavigationItem[] {
  return PRIMARY_NAV
}
```

Keep `SALES_CRM_SECONDARY` and the `getInboxNavigation` signature, but base it on the new consts:

```ts
export function getInboxNavigation(capabilities?: NavCapabilities): InboxNavigation {
  const secondary = capabilities?.salesCrm
    ? [...SECONDARY_NAV, ...SALES_CRM_SECONDARY]
    : SECONDARY_NAV
  return { primary: PRIMARY_NAV, secondary }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app-navigation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/app-navigation.ts tests/app-navigation.test.ts
git commit -m "feat(nav): 5-item primary navigation model"
```

### Task 1.2: Rebuild the desktop rail to the 5 primary items

**Files:**
- Modify: `app/components/AppRail.tsx`

- [ ] **Step 1: Update rail links.** Replace the current `RailLink` set (Home→/inbox, Approve, Tasks, Chat, Clean, Settings) with the 5 primary items pointing at `/home`, `/mail`, `/approvals`, `/clean-inbox`, `/settings`. Keep the logo linking to `/home`. Keep the `needsReplyCount` badge on **Mail** (it counts unread/needs-reply mail) and `pendingApprovals` badge on **Approvals**. Add an "Ask FlowDesk" trigger button above Settings that, for now, is a no-op placeholder (wired in Slice 4):

```tsx
{/* Ask FlowDesk — wired to the slide-over in Slice 4 */}
<button
  type="button"
  data-ask-flowdesk
  title="Ask FlowDesk"
  className="relative flex h-9 w-10 flex-col items-center justify-center gap-0.5 rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
>
  <ChatIcon />
  <span className="text-[8px] font-semibold leading-none">Ask</span>
</button>
```

Update `isEmailSection` to match `/mail` and `/conversations/`, add `isHome` for `/home`, drop the `isTasks`/`isChat` booleans.

- [ ] **Step 2: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/AppRail.tsx
git commit -m "feat(nav): rail shows 5 primary destinations + Ask trigger"
```

> **Note:** After Slice 1 the rail points at `/home` and `/mail`, which don't exist yet — they're built in Slice 2. Do not deploy Slice 1 alone; it is the first commit of the revamp branch. Manual browser verification happens at the end of Slice 2.

---

## Slice 2 — Home / Mail split (PR 2)

Branch: `web-revamp-home-mail` off `web-revamp-nav`. This is the core change.

### Task 2.1: Extract the control-room Home into `/home`

**Files:**
- Create: `app/home/page.tsx`
- Modify: `app/components/HomeCommandCenter.tsx`

- [ ] **Step 1: Create `app/home/page.tsx`.** Copy the **home-view branch** of `app/inbox/page.tsx` (the `isHomeView === true` data fetch + the `HomeCommandCenter` render), dropping everything that builds the list (`AppListColumn`, `mobileConversations`, list tabs, content-type pills). The page:
  - auth-guards (`getServerSession`; redirect `/login` if no `tenantId`),
  - fetches the command-center inputs exactly as the current home branch does (reuse the same `buildDailyCommandCenter` / `buildBillsSection` / `analyzeRevenueAtRisk` / automation-level / follow-up-setting / pending-approvals / active-rules calls),
  - renders `AppRail` + a single centered column containing `<HomeCommandCenter .../>` (no `DesktopResizablePanels`, no left list),
  - keeps the `WarmingUp` DB-starting fallback and `AutoRefresh`.

  Keep the exact prop wiring `HomeCommandCenter` already expects (see `app/inbox/page.tsx` lines ~495–508).

- [ ] **Step 2: Rename the section + add "View all".** In `app/components/HomeCommandCenter.tsx`, change the Bills sub-heading label and add the link:

```tsx
{billsSection.count > 0 && (
  <div className="flex flex-col gap-2">
    <SubHeading label="Tasks & Deadlines" badge={String(billsSection.count)} href="/tasks" hrefLabel="View all →" />
    <BillsDeadlinesList items={billsSection.items} />
  </div>
)}
```

(`SubHeading` already supports `href`/`hrefLabel` — see `HomeCommandCenter.tsx:63`.)

- [ ] **Step 3: Verify types.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/home/page.tsx app/components/HomeCommandCenter.tsx
git commit -m "feat(home): control-room Home at /home (no email list)"
```

### Task 2.2: Move the email list to `/mail`

**Files:**
- Create: `app/mail/page.tsx`

- [ ] **Step 1: Create `app/mail/page.tsx`.** Copy the **list branch** of `app/inbox/page.tsx` (everything gated by `!isHomeView`: status/attention/content-type filters, `AppListColumn`, mobile list, list tabs, `BulkCloseButton`, `GmailSyncControl`). It renders `AppRail` + `DesktopResizablePanels` with `AppListColumn` on the left and, as `main`, the "Select a conversation" placeholder (the reading pane is `/conversations/[id]`, unchanged). Preserve all `searchParams` (`status`, `q`, `attention`, `type`, `sales`, `page`).
  - The `sales`/`isBusiness` branches stay in the code but are inert for personal accounts (gated as today). Do **not** invest in them.

- [ ] **Step 2: Verify types + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/mail/page.tsx
git commit -m "feat(mail): email list + reading pane at /mail"
```

### Task 2.3: Redirect `/inbox` and repoint all links

**Files:**
- Modify: `app/inbox/page.tsx`, `app/login/page.tsx`, `app/onboarding/OnboardingFirstPass.tsx`, and the back-link/deep-link files listed in File Structure.

- [ ] **Step 1: Replace `app/inbox/page.tsx` with a redirect.** Home view → `/home`; any list/filter query → `/mail` (preserving the query string):

```tsx
import { redirect } from "next/navigation"

export default function InboxRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>
}) {
  const isListView =
    !!searchParams.status || !!searchParams.q || !!searchParams.sales ||
    !!searchParams.attention || !!searchParams.type || !!searchParams.page
  if (!isListView) redirect("/home")
  const qs = new URLSearchParams(
    Object.entries(searchParams).filter(([, v]) => v != null) as [string, string][],
  ).toString()
  redirect(qs ? `/mail?${qs}` : "/mail")
}
```

- [ ] **Step 2: Repoint post-login + onboarding.** In `app/login/page.tsx` change both `callbackUrl: "/inbox"` → `"/home"`. In `app/onboarding/OnboardingFirstPass.tsx` change both CTA `href="/inbox"` → `href="/home"`.

- [ ] **Step 3: Repoint "back to control room" links.** In each of `app/settings/page.tsx`, `app/tasks/page.tsx`, `app/audit/page.tsx`, `app/approvals/page.tsx`, `app/meetings/page.tsx`, `app/leads/page.tsx`, `app/reports/page.tsx`, `app/risk-radar/page.tsx`, `app/knowledge-base/page.tsx`, `app/clean-inbox/CleanInboxClient.tsx`: change the control-room back-link `href="/inbox"` → `"/home"`. (These are the `← Back to control room` links.) Leave the Sales-gate `redirect("/inbox")` calls in `leads/reports/risk-radar/meetings/knowledge-base` pointing at `/home` too.

- [ ] **Step 4: Repoint list deep-links.** Change list-view links from `/inbox?...` → `/mail?...`:
  - `app/components/ReadLaterSection.tsx:177` `/inbox?attention=read_later` → `/mail?attention=read_later`
  - `app/components/QuietlyHandledBanner.tsx:50` `/inbox?status=closed` → `/mail?status=closed`
  - `app/components/AppListColumn.tsx:346` `/inbox?sales=1...` → `/mail?sales=1...`
  - `app/conversations/[id]/page.tsx` — the `getSafeInboxReturnPath` default and any `/inbox` return target → `/mail` (the reading pane returns to the list, not Home).

- [ ] **Step 5: Grep to confirm nothing stale remains.**

Run: `git grep -n '"/inbox"' -- 'app/**' 'lib/**'`
Expected: only the redirect stub in `app/inbox/page.tsx` (and no `href`/`callbackUrl` occurrences). Fix any stragglers.

- [ ] **Step 6: Full verification.**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 7: Manual end-to-end** (dev server): log in → lands on `/home` showing the control room with **no list**; "Tasks & Deadlines" renders with a working "View all →" to `/tasks`; visiting `/mail` shows the list + filters; opening a conversation returns to `/mail`; `/inbox` redirects to `/home`, `/inbox?status=closed` redirects to `/mail?status=closed`. Use the `verify` skill / running dev server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(nav): redirect /inbox, repoint links to /home and /mail"
```

---

## Slice 3 — Settings route-based tabs (PR 3)

Branch: `web-revamp-settings` off `web-revamp-home-mail`.

### Task 3.1: Tab metadata (pure, tested)

**Files:**
- Create: `lib/settings-tabs.ts`, `tests/settings-tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings-tabs.test.ts
import { describe, it, expect } from "vitest"
import { SETTINGS_TABS } from "@/lib/settings-tabs"

describe("settings tabs", () => {
  it("defines the six personal-account tabs in order", () => {
    expect(SETTINGS_TABS.map((t) => t.slug)).toEqual([
      "connect", "gmail", "automation", "training", "profile", "data",
    ])
  })
  it("gives every tab a route under /settings", () => {
    for (const t of SETTINGS_TABS) expect(t.href).toBe(`/settings/${t.slug}`)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run tests/settings-tabs.test.ts`).

- [ ] **Step 3: Create `lib/settings-tabs.ts`**

```ts
export type SettingsTab = { slug: string; label: string; description: string; href: string }

const TABS: Omit<SettingsTab, "href">[] = [
  { slug: "connect", label: "Connect", description: "Gmail, Outlook, health" },
  { slug: "gmail", label: "Gmail", description: "Native labels and sync" },
  { slug: "automation", label: "Automation", description: "Follow-ups and trust level" },
  { slug: "training", label: "Training", description: "Rules, voice, snippets" },
  { slug: "profile", label: "Profile", description: "Features, VIPs" },
  { slug: "data", label: "Data", description: "Apps, AI budget" },
]

export const SETTINGS_TABS: SettingsTab[] = TABS.map((t) => ({ ...t, href: `/settings/${t.slug}` }))
```

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/settings-tabs.ts tests/settings-tabs.test.ts
git commit -m "feat(settings): tab metadata"
```

### Task 3.2: Settings layout + per-tab routes

**Files:**
- Create: `app/settings/layout.tsx`, `app/settings/{connect,gmail,automation,training,profile,data}/page.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Create `app/settings/layout.tsx`.** Server component rendering the existing header (title, "← Back to control room" → `/home`) + a horizontal/sidebar tab nav built from `SETTINGS_TABS` (highlight active via `usePathname` in a small client `SettingsTabNav.tsx`, or use `<a>` with `aria-current` computed from the segment). Render `{children}` in the content column. Reuse the current `<main className="mx-auto grid max-w-6xl ...">` shell from `app/settings/page.tsx`.

- [ ] **Step 2: Split the data fetch and panels per tab.** Move each panel group from the monolithic `app/settings/page.tsx` into its tab's `page.tsx`, and with it **only the queries that panel needs** (the current page front-loads ~30 queries in two `Promise.all`s; each tab fetches its own subset):
  - `connect/page.tsx`: Gmail + Outlook channels, operator-health inputs → Connectors section + `GmailOperatorHealthPanel`.
  - `gmail/page.tsx`: `gmailLabelMappings` → `FixGmailLabelsButton` + `GmailLabelSettingsPanel` (guard: only if a Gmail channel exists).
  - `automation/page.tsx`: `followUpSetting`, `autopilotSetting`, `learnedReplyProfile` (for the gate) → `FollowUpSettingsForm` + `AutopilotSettingsForm`. **Omit** `WorkflowsPanel` (deferred).
  - `training/page.tsx`: `learnedReplyProfile` + usage, `senderRules`, `staticRules`, `plainEnglishRules` → `PersonalStylePanel` + `SenderRulesPanel` + `TrainAgentPanel`. **Omit** `SnippetsPanel` (deferred).
  - `profile/page.tsx`: `tenant.salesCrmEnabled`, `vipContacts` → `SalesCrmModeToggle` + `VipContactsForm`. **Omit** `BusinessProfileForm` (Sales-only).
  - `data/page.tsx`: `googleDriveCredential`, `getAiBudgetStatus` → `ConnectedAppsPanel` + `AiBudgetPanel`. **Omit** `KnowledgeDocumentList`, `ConciergeTemplateSeedButton` (deferred/Sales).
  - Keep the `?connected=`/`?error=` success/error banners on `connect/page.tsx`.
  - **Do not delete** the omitted panel components — they stay in `app/settings/` for when Sales/deferred features return.

- [ ] **Step 3: Make `/settings` redirect.** Replace `app/settings/page.tsx` body with `redirect("/settings/connect")`. Preserve deep-link intent: the old anchors (`#automation`, etc.) map to tab routes — update the one in-app link (`app/components/HomeCommandCenter.tsx` "What it learned" → change `/settings` to `/settings/training`; `ControlRoomHeader`'s automation link `/settings#automation` → `/settings/automation`).

- [ ] **Step 4: Verify.**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Manual** — each `/settings/<tab>` loads independently, shows only its panels, back-link goes to `/home`, `/settings` redirects to `/settings/connect`, deferred panels (Workflows/Snippets/KB/Concierge/BusinessProfile) absent on a personal account.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): route-based tabs with per-tab data fetching"
```

---

## Slice 4 — Global "Ask FlowDesk" slide-over (PR 4)

Branch: `web-revamp-assistant` off `web-revamp-settings`.

### Task 4.1: Slide-over panel component

**Files:**
- Create: `app/components/AskFlowDeskPanel.tsx`
- Modify: `app/components/AppRail.tsx`, `app/home/page.tsx`, `app/mail/page.tsx`

- [ ] **Step 1: Inspect the existing chat surface** so the panel reuses it, not reinvents it.

Run: `sed -n '1,80p' app/chat/*.tsx && ls app/api/chat`
Expected: identify the client chat component + the `POST /api/chat` contract (message list, budget gating).

- [ ] **Step 2: Create `app/components/AskFlowDeskPanel.tsx`** — a `"use client"` component: a right-anchored slide-over (fixed, `translate-x` transition, backdrop) containing the chat UI. It listens for clicks on `[data-ask-flowdesk]` (set in Slice 1) via a module-level custom event or a shared context, toggles open/closed, and calls the same `/api/chat` endpoint the existing chat page uses. Keep it self-contained; no server props required beyond what chat already needs (tenant is derived server-side from session in the API route).

```tsx
"use client"
import { useEffect, useState } from "react"

export default function AskFlowDeskPanel() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const handler = (e: Event) => {
      const t = e.target as HTMLElement
      if (t.closest("[data-ask-flowdesk]")) setOpen(true)
    }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [])
  // ...backdrop + slide-over container + reused chat UI...
}
```

- [ ] **Step 3: Mount it** at the bottom of the returned tree in `app/home/page.tsx` and `app/mail/page.tsx` (both shell pages that render `AppRail`). Optionally also on `app/conversations/[id]/page.tsx` for parity.

- [ ] **Step 4: Remove Chat from any remaining nav** — confirm `/chat` is not in `PRIMARY_NAV`/`SECONDARY_NAV` (it isn't after Slice 1) and the rail has no Chat link (replaced by the Ask trigger).

- [ ] **Step 5: Verify + manual.**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Then manually: the "Ask" rail button opens the slide-over on `/home` and `/mail`; sending a message hits `/api/chat` and streams a reply; closing works; budget-exceeded returns a controlled error (as the chat page already handles).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(assistant): global Ask FlowDesk slide-over"
```

---

## Slice 5 — Delete dead routes (PR 5)

Branch: `web-revamp-cleanup` off `web-revamp-assistant`.

### Task 5.1: Remove `/digest` and `/search`

**Files:**
- Delete: `app/search/` and `app/digest/` (whichever exist)
- Modify: any references.

- [ ] **Step 1: Confirm what exists + who links to them.**

Run: `ls app/search app/digest 2>/dev/null; git grep -n '/digest\|/search' -- 'app/**' 'lib/**'`
Expected: `app/search/page.tsx` (redirect stub) exists; `/digest` referenced in `app/settings/*` follow-up copy and possibly mobile nav. Note every hit.

- [ ] **Step 2: Remove the routes.** `git rm -r app/search` (and `app/digest` if a directory exists). The `/settings` follow-up copy links to `/digest` (`app/settings/page.tsx:726` in the old monolith → now in `automation/page.tsx`): replace that "daily digest" link with plain text or point it at `/home` (the digest surface no longer exists). Remove any `Digest` entry from mobile nav (already dropped from `lib/app-navigation.ts` in Slice 1 — confirm nothing else hard-codes it).

- [ ] **Step 3: Confirm no dangling references.**

Run: `git grep -n '/digest\|/search' -- 'app/**' 'lib/**'`
Expected: no results.

- [ ] **Step 4: Verify.**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass. Manually: navigating to `/search` or `/digest` 404s (or cleanly redirects if you chose redirects); no broken links anywhere in the app.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(nav): remove dead /digest and /search routes"
```

---

## Final verification (before opening the last PR / merging the branch)

- [ ] `npm test && npx tsc --noEmit && npm run lint && npm run build` all green.
- [ ] Manual sweep against a running dev server (use the `verify` skill):
  - Rail + mobile nav show exactly: Home · Mail · Approvals · Clean · Settings (+ Ask trigger). No Tasks/Chat/Digest/Search icons.
  - `/home` = control room, no list, "Tasks & Deadlines" + "View all →".
  - `/mail` = list + filters + reading pane; `/inbox` and its query variants redirect correctly.
  - `/settings` redirects to `/settings/connect`; all 6 tabs load independently; deferred/Sales panels absent for a personal account.
  - "Ask FlowDesk" slide-over opens app-wide and works.
  - No `/inbox`, `/digest`, `/search` links remain (`git grep`).
- [ ] Update living docs per `docs/README.md`: reflect the new IA in `docs/CURRENT_STATE.md` (Landing/Control-room sections), `docs/product-direction.md` (dashboard surfaces), and check off the relevant Phase 3 items in `docs/TODO.md`.

---

## Self-Review (completed by plan author)

**Spec coverage:** Every spec section maps to a task — Home-only-control-room (2.1), keep-list-own-page (2.2), 5-item nav (1.1/1.2), settings route tabs (3.1/3.2), chat slide-over (4.1), Tasks/Activity demotion (1.1 nav + 2.1 View-all link), deletions (5.1), Sales fully deferred (no task touches it beyond confirming gates), route note `/` stays landing + Home at `/home` (2.1/2.3). Classification follow-ups intentionally excluded (non-goal).

**Placeholder scan:** No "TBD"/"handle edge cases"-style placeholders; large existing blocks are described as explicit copy-with-exclusions moves (the source lines are cited) rather than re-inlined, which is the correct instruction for relocating 700-line pages.

**Type/name consistency:** `getPrimaryNav`, `PRIMARY_NAV`, `SECONDARY_NAV`, `SETTINGS_TABS`, `SettingsTab`, `AskFlowDeskPanel`, `[data-ask-flowdesk]` are used consistently across tasks. `SubHeading` `href`/`hrefLabel` props verified to already exist. `getInboxNavigation` signature preserved.
