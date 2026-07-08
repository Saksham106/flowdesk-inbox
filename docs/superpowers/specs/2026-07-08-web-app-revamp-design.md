# FlowDesk Web App Revamp — Design Spec

Date: 2026-07-08
Branch: `web-revamp`
Status: Approved design → ready for implementation plan

## Problem

FlowDesk's web app has grown "wide and shallow." The single biggest UX
complaint is that the app feels **crowded**: the `/inbox` screen does five jobs
at once, and there are too many reachable pages for a product that is supposed
to be a focused *control room*, not an email client.

Concretely, today:

- **`/inbox` renders three surfaces side-by-side** on desktop: the nav rail, the
  full email **list column** (`AppListColumn` — status pills + 4 content-type
  pills + conversation rows), and the entire **command-center dashboard**
  (`HomeCommandCenter`: Handle First, Needs Action, Bills & Deadlines, Waiting
  On, Read Later, Quietly Handled). Mobile crams ~15 filter tabs into one
  horizontally-scrolling bar.
- **`/settings` is 16 panels stacked on one route** with anchor-scroll nav.
- **~15 routes are reachable**, several dead or redundant (`/digest` is a bare
  redirect; `/search` already redirects to `/inbox`).

The product direction (`docs/product-direction.md`) already says the web app is
the **secondary** surface — a control room for setup, supervision, approvals,
training — and that we should take direct IA inspiration from Inbox Zero. Inbox
Zero's lesson, confirmed by reading its actual route tree and `SideNav.tsx`, is
**one job per screen**: it splits mail, assistant/rules, reply tracking, each
cleanup tool, analytics, and settings into separate focused routes.

This spec makes FlowDesk's web app match that principle.

## Goals

1. **Home is a calm control room** — no email list on it. One glance answers
   "what needs me?" and "what did the agent do?".
2. **Keep the in-app email list**, but on its own dedicated page.
3. **Collapse navigation to 5 primary destinations**, matching Inbox Zero's
   simplicity.
4. **Decompose Settings** into real, independently-loaded route-based tabs.
5. **Cut dead/redundant pages**; demote power-user pages to links.
6. **Personal accounts only.** The Sales & CRM cluster stays built but fully
   deferred and gated off — no work on it in this effort.

## Non-goals (explicitly out of scope)

- Sales & CRM surfaces (Leads, Reports, Risk Radar, Meetings, Knowledge Base) —
  stay gated behind `salesCrmEnabled` (off by default). No polish, no "More"
  menu investment now.
- Classification algorithm changes — the deterministic content-first classifier
  is in good shape. Surfacing "why this label" evidence + confidence and
  draft-edit learning are real future wins but are tracked separately, **not in
  this spec**.
- Outlook parity, Gmail add-on / browser extension, CC/BCC send, team inboxes,
  new analytics dashboards. All remain deferred per `docs/product-direction.md`.

## Target information architecture

### Primary navigation — 5 destinations

Both the desktop rail (`AppRail`) and the mobile nav collapse to:

| Nav item | Route | Job |
| --- | --- | --- |
| 🏠 **Home** | `/home` (control room) | Supervise: what needs you, what the agent did/learned. **No email list.** |
| ✉️ **Mail** | `/mail` | The in-app email list + reading pane. The list the user likes, given room to breathe. |
| ✓ **Approvals** | `/approvals` | Drafts & actions awaiting a decision. First-class trust surface (unchanged). |
| 🧹 **Clean** | `/clean-inbox` | Bulk unsubscribe / archive (unchanged; matches Inbox Zero Cleanup). |
| ⚙️ **Settings** | `/settings/*` | Route-based tabs (see below). |

Rationale for keeping exactly these five: Home + Mail cover the daily loop;
Approvals + Clean are the two supervision/cleanup actions users actually reach
for; Settings is unavoidable. Everything else is lower-frequency and becomes a
link or a panel.

### Folded in / demoted (route kept, nav slot removed)

- **Chat → global slide-over assistant.** An "Ask FlowDesk" affordance on every
  page opens a slide-over panel reusing the existing `/chat` logic. Removed from
  nav. `/chat` route may stay as a fallback full-page view or be removed once the
  panel is proven — implementation detail for the plan.
- **Tasks → Home, done correctly.** `/tasks` is the full management list
  (Overdue / Upcoming / No-due-date, up to 200 `inboxTask` rows). Home's "Bills &
  Deadlines" is only a ≤7-day preview. Fold by: **renaming the Home section to
  "Tasks & Deadlines,"** keeping it as the at-a-glance preview, and adding a
  **"View all →"** link to the full list at `/tasks`. Remove `/tasks` from the
  nav rail; keep the route as the "view all" destination. No functionality lost —
  same pattern already used for Activity and Search.
- **Activity → link from Home.** `/audit` stays reachable via Home's "What it
  did → Full activity log →" link (already the case) and the route stays; not a
  rail icon.

### Deleted

- **`/digest`** — bare `redirect("/inbox")`, no content. Remove route + any nav
  reference (mobile header nav still lists it).
- **`/search`** — already redirects to `/inbox`; its message-body search is in
  Home/Mail's search box. Remove the route; ensure any inbound links resolve.

### Deferred / gated (no change beyond confirming they're off the default path)

- Sales & CRM routes: `/leads`, `/reports`, `/risk-radar`, `/meetings`,
  `/knowledge-base`. Remain gated by `salesCrmEnabled`. Confirm none appear in the
  personal-account default nav.

## Page-level designs

### Home (`/home`) — control room only

- **Route note:** `/` stays the **public marketing landing page**
  (`app/page.tsx`) for logged-out visitors. The authenticated control-room Home
  lives at `/home`. Post-login redirects (currently → `/inbox`) and the
  onboarding "Go to your control room →" CTA repoint to `/home`; `/inbox`
  redirects to `/home`.
- Renders `HomeCommandCenter` **without** `AppListColumn`. The desktop
  three-panel `DesktopResizablePanels` layout on the home view collapses to a
  single centered control-room column (the list moves to `/mail`).
- Keep the two-pillar structure: **"What needs you"** (Approvals banner, Handle
  First, Needs Action, Tasks & Deadlines) and **"The agent"** (What it did → full
  activity log, What it learned → Settings, Waiting On, Read Later), with the
  full-width **Quietly Handled** banner at the bottom.
- Rename **"Bills & Deadlines" → "Tasks & Deadlines"** and add the **"View all
  →"** link to `/tasks`. The section still sources the same data
  (`buildBillsSection`: due-soon `inboxTask` + `review_soon` conversations); only
  the label and the added link change.
- Control-room header keeps the automation-level link to `/settings/automation`
  and the honest "Connect Gmail" first-run state.

### Mail (`/mail`) — the email list

- Owns `AppListColumn` (list) + the reading pane. Reading a conversation
  (`/conversations/[id]`) renders within the Mail shell.
- Status filters + the 4 content-type filter pills (Newsletter / Marketing /
  Notification / Calendar) live **here**, off Home.
- The current `/inbox` route becomes a redirect to `/mail` (or `/` for the home
  view) so existing links/bookmarks don't break. The split of `isHomeView` logic
  currently inside `app/inbox/page.tsx` is the main refactor: the home branch
  moves to the `/home` route, the list branch moves to `/mail`. `/inbox`
  redirects (home view → `/home`, any list/filter query → `/mail`).

### Chat — global slide-over assistant

- A persistent "Ask FlowDesk" button (in the rail or a floating affordance)
  opens a slide-over panel on any page, reusing `/chat` request logic and budget
  gating. Scoped context (current conversation on Mail) is a nice-to-have, not
  required for v1 of the panel.

### Settings (`/settings/*`) — route-based tabs

Split the one-route, 16-panel page into independently-loaded routes. Each tab
fetches only its own data (the current page does ~30 queries up front for all
panels):

| Tab route | Panels |
| --- | --- |
| `/settings/connect` | Connectors (Gmail, Outlook), operator health |
| `/settings/gmail` | Gmail labels, Fix Gmail labels |
| `/settings/automation` | Follow-up automation, Automation level (trust ladder) |
| `/settings/training` | Reply learning, Attention rules, Train my agent |
| `/settings/profile` | Features (Sales & CRM toggle), VIP contacts |
| `/settings/data` | Connected apps, AI spend budget |

- A shared `/settings` layout renders the tab nav; `/settings` redirects to the
  first tab (`/settings/connect`).
- **Deferred panels hidden from the default (personal) surface:** Workflows,
  Concierge Templates, Snippets & Playbooks, Knowledge Base, Google Calendar /
  MindBody connectors, Business Profile. These are already gated `!isPersonal`
  (Sales) or belong to deferred features; keep them out of the personal tabs.
  Preserve the code — do not delete the panels.
- Keep deep links working: existing `#automation` etc. anchors should resolve to
  the corresponding tab route.

## Design principles to hold

- **One job per screen.** If a screen starts doing two unrelated jobs, it needs
  splitting.
- **Nothing half-built on the default path.** Deferred/Sales panels stay gated.
- **No lost functionality when demoting.** Every removed nav slot keeps its route
  reachable via a link (Tasks, Activity) unless the route is genuinely dead
  (`/digest`, `/search`).
- **Follow existing patterns.** Reuse `SettingsSectionGroup`-style grouping,
  existing components, existing data helpers. This is IA/layout surgery, not a
  rewrite of the underlying logic.

## Affected areas (for the implementation plan)

- `lib/app-navigation.ts` — nav model (remove Digest/Tasks from primary; the
  5-item structure; drop dead entries).
- `app/components/AppRail.tsx` — desktop rail to 5 items; add "Ask FlowDesk".
- `app/inbox/page.tsx` — split home vs list; becomes redirect(s).
- New `app/(home)/page.tsx` (or repurposed root) — control-room Home.
- New `app/mail/` — list + reading pane shell.
- `app/components/HomeCommandCenter.tsx` — drop list dependency; rename section;
  add "View all" link.
- `app/settings/` — decompose into `app/settings/layout.tsx` + per-tab routes;
  split the monolithic data fetch per tab.
- Global assistant slide-over component (new) + wiring from the shell.
- Remove `app/digest/`, `app/search/` routes; update mobile nav.
- `app/conversations/[id]/` — ensure it renders within the Mail shell.

## Verification

Per `CLAUDE.md`, before any PR:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Plus manual end-to-end checks against a running dev server:

- Home shows the control room with **no** email list; "Tasks & Deadlines"
  renders with a working "View all →".
- `/mail` shows the list + reading pane; filters work; `/inbox` redirects.
- Each `/settings/*` tab loads independently and shows only its panels; deep
  links resolve; deferred/Sales panels absent on a personal account.
- Global "Ask FlowDesk" panel opens on Home, Mail, and Settings.
- `/digest` and `/search` are gone (or redirect) with no broken nav links.
- Nav rail + mobile nav show exactly the 5 primary destinations for a personal
  account.

## Rollout note

This is a large IA change touching routing. Recommend implementing in reviewable
slices (nav model → Home/Mail split → Settings tabs → Chat panel → deletions)
rather than one mega-PR, each independently verifiable. The implementation plan
(next step, via writing-plans) will sequence these.
