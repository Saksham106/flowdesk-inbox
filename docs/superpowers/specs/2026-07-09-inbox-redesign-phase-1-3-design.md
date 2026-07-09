# FlowDesk Inbox Redesign — Phases 1–3 Design Spec

Date: 2026-07-09
Status: Approved design → ready for implementation plan
Builds on: `docs/superpowers/specs/2026-07-09-flowdesk-inbox-redesign-research.md` (research/options doc)
Supersedes nav model from: `docs/superpowers/specs/2026-07-08-web-app-revamp-design.md` (fully shipped — `/home`,
`/mail`, `/settings/*` tabs, Ask FlowDesk panel all exist today)

## Problem

The web-app-revamp (2026-07-08) shipped a calm 5-item nav (Home · Mail · Approvals · Clean · Settings) and split
Home/Mail/Settings correctly. The research doc (2026-07-09) proposes going further: a thin icon rail plus an
expanded collapsible sidebar, full-width horizontal Mail rows instead of the current compact list, a first-class
Assistant area for rules (currently buried in Settings → Training), and a split Cleanup section (Bulk
Unsubscribe / Bulk Archive / Analytics). This spec locks the decisions needed to implement that as Phases 1–3,
without a reading pane or keyboard shortcuts (Phase 4, deferred).

## Scope

In scope (this spec):

- Phase 1: nav restructure to a 7-item primary rail + expanded sidebar; full-width Mail rows; top category tabs.
- Phase 2: first-class `/assistant` area (Rules / Test Rules / History / Settings tabs).
- Phase 3: Cleanup split (Bulk Archive stays at `/clean-inbox`; add Bulk Unsubscribe + Analytics).

Out of scope (deferred, per the research doc's own Phase 4 and non-goals):

- Right-side reading pane inside `/mail` and query-param-driven conversation selection.
- Keyboard shortcuts (`j`/`k`/`e`/`h`/`/`/`c`, command palette).
- Any schema migration, new provider abstraction, new automated rule actions beyond existing safe
  attention/workflow mappings, auto-send/auto-unsubscribe/auto-delete, or conversation-detail internals rewrite.

## Decisions locked (resolving the research doc's Open Decisions + one gap it left)

1. **Assistant is a primary rail item.** Rail order: Home · Mail · Assistant · Approvals · Cleanup · Tools ·
   Settings. Ask FlowDesk remains a separate global chat-trigger button (`[data-ask-flowdesk]`, existing
   `AskFlowDeskPanel`), not merged into the Assistant rail item.
2. **Approvals gets its own primary rail slot** (7th item) rather than folding into Mail's sidebar group — the
   research doc's proposed nav omitted it, but it's a trust-critical surface shipped in the prior revamp and must
   not lose visibility.
3. **`/clean-inbox` stays canonical** for Bulk Archive. New Bulk Unsubscribe and Analytics routes/tabs are added
   alongside it rather than moving everything to a new `/cleanup/*` tree.
4. **Draft Ready gets its own row pill but counts under the Needs Reply tab** by default (not a separate top
   tab) — it still needs the user's attention.
5. **No reading pane in this scope.** Mail row click continues to navigate to `/conversations/[id]`.

## Navigation model

Rail (`lib/app-navigation.ts` `PRIMARY_NAV`), in order:

| Item | Route |
| --- | --- |
| Home | `/home` |
| Mail | `/mail` |
| Assistant | `/assistant` (redirects to `/assistant/rules`) |
| Approvals | `/approvals` |
| Cleanup | `/clean-inbox` |
| Tools | `/tools` (Phase 1: placeholder landing page only — see below) |
| Settings | `/settings` |

Expanded collapsible sidebar (new `AppSidebar` component), sectioned by which rail item is active:

- **Mail** section (when on `/mail` or `/conversations/[id]`): Inbox, Needs Reply, Waiting On, Read Later, Done,
  Drafts, Sent — implemented as links with the existing `status`/`attention`/`type` query params against `/mail`.
  Drafts/Sent are new lightweight filters over existing data (`Draft.status`, sent conversations); if no cheap
  query exists for one, it renders but the underlying `/mail` filter is added as a new query param rather than a
  new page.
- **Assistant** section: Rules, Test Rules, History, Settings — matches the 4 new route tabs.
- **Cleanup** section: Bulk Archive (`/clean-inbox`), Bulk Unsubscribe (`/clean-inbox/unsubscribe`), Analytics
  (`/clean-inbox/analytics`).
- **Tools** section: Phase 1 ships only a placeholder page listing "Coming soon" for Calendar / Meeting Briefs /
  Attachments — these are not built features today and the spec's non-goals forbid pretending they work. No
  sidebar sub-items beyond the placeholder note.
- Home / Approvals / Settings: sidebar collapses to just the section title (no sub-items) or is hidden — these
  pages don't have sub-navigation today.

Sidebar is collapsible (icon-only vs. expanded), state persisted in `localStorage` similar to
`DesktopResizablePanels`' existing width persistence pattern.

The thin `AppRail` keeps rendering on every shell page; `AppSidebar` is new and renders next to it only on pages
that have sub-navigation (Mail, Assistant, Cleanup, Tools). Home/Approvals/Settings keep their current layout
(Settings already has its own tab nav via `app/settings/layout.tsx`).

## Mail page redesign

`/mail` desktop layout changes from `DesktopResizablePanels` (narrow list + placeholder main) to:

- `AppRail` + `AppSidebar` (Mail section) on the left.
- Full main content area:
  - Top bar: current mailbox label, search, sync status, category tabs.
  - `MailTopTabs`: Important, Needs Reply, Waiting On, Read Later, Other, Calendar — URL-driven
    (`?tab=needs_reply` etc.), computed from `deriveWorkflowStatus()` / `ConversationState.emailType` /
    existing priority signals. No new persisted "important" status — Phase 1 computes Important from existing
    needs-action/priority metadata only.
  - `MailInboxTable` rendering `MailInboxRow` per conversation: unread marker, sender, status/content pills
    (including the Draft Ready pill), subject, snippet, timestamp, hover actions (reuse `InboxRow`'s existing
    action handlers/endpoints — read/unread, tag/status, snooze, archive, done/reopen).
  - Secondary filter access (Newsletter/Marketing/Notification/Calendar) preserved as today, now as a small
    filter control near the tabs rather than pills mixed into the primary tab row.
- Query params preserved: `status`, `q`, `sales`, `attention`, `type`, `page`, plus new `tab`.
- Row click still navigates to `/conversations/[id]` with `returnTo` preserved.
- Mobile `/mail` is unchanged in this scope (existing mobile list stays).
- Data source: reuse `AppListColumn`'s query/mapping logic — extract a shared helper rather than duplicating the
  Prisma query, since Phase 1 already touches this file.

## Assistant area

New routes, each a thin page pulling in the existing panel components:

- `/assistant` → redirect to `/assistant/rules`.
- `/assistant/rules` — reuses `SenderRulesPanel` (static rules, create/preview/enable/disable/remove/version
  history) and the `AgentRule` list currently on Settings Training.
- `/assistant/test-rules` — dry-run UI: reuses the dry-run call to `/api/agent-rules/dry-run` currently
  accessible from the rules panel; surfaced as its own tab per the research doc's Assistant plan.
- `/assistant/history` — rule version snapshots / rule-related `AuditLog` entries.
- `/assistant/settings` — reuses `TrainAgentPanel` (plain-English rules) plus any assistant-specific settings
  currently mixed into Settings Training; general account settings stay in `/settings/training`.

`app/settings/training/page.tsx` keeps working (no functionality removed) but gets a banner linking to
`/assistant` as the new primary location, matching the pattern already used for Tasks/Activity in the prior
revamp (demote via link, don't delete).

No changes to `AgentRule`/`SenderRule`/`AutomationRun`/`AuditLog` schema. No new rule action types — Phase 2
only relocates UI, it does not expand what rules can do.

## Cleanup split

- `/clean-inbox` (existing) — becomes explicitly "Bulk Archive" in its own heading/copy; behavior unchanged
  (sender-grouped archive candidates, undo).
- `/clean-inbox/unsubscribe` (new) — same sender-grouping (`groupCleanupBySender()`), filtered to
  `hasUnsubscribe === true`; reuses `app/api/clean-inbox/unsubscribe-batch/route.ts` and the undo route.
- `/clean-inbox/analytics` (new) — Phase 1-scope simple: counts by sender/domain/content type and cleanup
  impact, computed from existing `ConversationState`/`Conversation` queries already used by the cleanup grouping
  logic. No new schema, no historical trend storage.
- A small tab strip (reusing the `SettingsTabNav`-style pattern) sits above the three cleanup pages so users can
  move between Bulk Archive / Bulk Unsubscribe / Analytics without going back through the sidebar.

## Data model

No schema changes anywhere in this spec, matching the research doc's Data Model Notes:

- Mail tabs: `Conversation.status`, `Conversation.userState` (wins over AI-derived state), `Draft.status`,
  `ConversationState.attentionCategory`/`emailType`, all via `deriveWorkflowStatus()`.
- Assistant: existing `AgentRule.conditionsJson`/`actionJson.targetAttention`.
- Cleanup: existing sender-grouping and `GmailWritebackQueue`/`AuditLog`.

## Risks carried forward from the research doc

- Full-width Mail rows must keep using `deriveWorkflowStatus()` consistently so manual `userState` continues to
  win over AI-derived state.
- `/conversations/[id]` return paths, `/mail?status=...`/`?type=...`/`?q=...` links, and `/inbox` redirect
  compatibility must keep working unchanged.
- New row actions must call existing endpoints, not new ones.
- Sidebar is new global-ish chrome on top of the per-page shell pattern — scope it to Mail/Assistant/Cleanup/
  Tools pages only, don't attempt a full shared-layout refactor in this pass.
- Keep initial Mail desktop query at 50 conversations (unchanged); don't add pagination/virtualization in this
  scope.

## Verification

Per `CLAUDE.md`, before any PR:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Manual checks against a running dev server:

- Rail shows exactly 7 items in order: Home, Mail, Assistant, Approvals, Cleanup, Tools, Settings.
- `/mail` desktop shows full-width rows with working top category tabs; search/status/content filters still
  work; hover actions still call existing endpoints; clicking a row opens `/conversations/[id]`.
- `AppSidebar` renders Mail/Assistant/Cleanup/Tools sub-navigation and collapses/expands, persisting state.
- `/conversations/[id]` still shows the left list, main thread, and right context panel unchanged.
- `/assistant/rules` can create/preview/enable/disable/remove rules and see version history; draft rules still
  require dry-run before activation (unchanged backend gate); `/settings/training` still works and links to
  `/assistant`.
- `/clean-inbox` (Bulk Archive), `/clean-inbox/unsubscribe`, `/clean-inbox/analytics` all load; archive/
  unsubscribe/undo behavior unchanged; safety-skip rules unchanged.
- Mobile Mail/Settings/Approvals unaffected.
- `/tools` shows a "coming soon" placeholder, not a broken or misleading page.

## Rollout note

Implement as sequential slices, each independently verifiable, mirroring the prior revamp's approach:

1. Nav model + rail (7 items) + `AppSidebar` shell (no sub-items wired yet beyond structure).
2. Full-width Mail rows + top tabs on `/mail`, wired into the sidebar's Mail section.
3. `/assistant/*` routes reusing existing panels, wired into the sidebar's Assistant section.
4. `/clean-inbox` split (Bulk Archive relabel + Bulk Unsubscribe + Analytics), wired into the sidebar's Cleanup
   section.
5. `/tools` placeholder page.
