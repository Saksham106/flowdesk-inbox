# FlowDesk Current State

Last updated: 2026-06-16 (Gmail archive + trash with writeback; personal/business action split — personal accounts no longer see confusing done/reopen quick action or Close/Reopen thread button; inbox preview now shows subject + snippet combined; attention/read/status persistence fixes; reopen icon SVG + attention dropdown z-index via React portal + email iframe height; richer inbox hover actions; email link sandbox fix; sync idempotency; Home card UX; Phase 1 gaps + Phase 2 concierge templates; inbox UX polish)

This file is the codebase-facing companion to `MASTER_PRODUCT_PLAN.md`. It answers: what exists today, what is partial, and what should not be treated as active scope.

## Maintenance Instructions For AI Agents

Update this file whenever code changes what FlowDesk can actually do. Do not leave this file aspirational; that belongs in `MASTER_PRODUCT_PLAN.md`.

Required updates:

- Add new shipped capabilities under the relevant implemented foundation.
- Move items out of "Not Yet Implemented" when they become real product behavior.
- Keep "Partial Features" honest when only infrastructure or a first slice exists.
- Add blocked verification notes when a feature cannot be visually or locally tested.
- Remove stale limitations once tests or code prove they are no longer true.

If this file and the code disagree, fix the doc in the same branch as the code change.

## Product Position

FlowDesk is currently an email-first AI inbox agent for individuals and small businesses. The MVP direction is personal/work-email friendly by default, with business revenue/support features available only when the account is in business mode. The product is moving from "AI draft replies" toward an "AI chief of staff for your inbox": daily command center, safe handling, follow-ups, relationship context, task extraction, account-appropriate classification, and approval-gated automation.

Email is the active channel. SMS/Twilio is not part of the active product path.

## Implemented Foundations

### Auth And Tenancy

- Credentials-based auth with NextAuth.
- Tenant-scoped user model.
- Most server reads and writes are scoped by `tenantId`.
- `Tenant.accountType` (`personal` or `business`) is the current source of truth for account mode.
- `lib/account-mode.ts` provides the shared account-mode helper. Unknown or missing account types default to personal-safe behavior.
- The storage model still uses `Tenant` internally for isolation. Product-facing UI should say account/workspace/profile where possible; do not rename the Prisma model without a dedicated migration plan.

### Email And Calendar Connectors

- Gmail connector routes exist for connect, callback, sync, push notification processing, watch renewal, and disconnect.
- Outlook connector routes exist for connect, callback, sync, and disconnect.
- Google Calendar connector routes exist for connect, callback, and disconnect.
- Calendar availability and calendar hold support exist.

### Inbox Core

- Conversation inbox at `/inbox`.
- Conversation detail pages at `/conversations/[id]`.
- Conversation statuses: `needs_reply`, `in_progress`, `closed`.
- Business labels for common AI classifications. Personal accounts do not show CRM labels in the inbox or conversation detail.
- Manual send path through shared send helper.
- Audit log model and audit page.

Inbox navigation refactor (2026-06-13):

- `/inbox` (no params) = **Home** tab — shows `CommandCenterPanel` (Today's Inbox Brief), follow-ups tracker, and safely-ignored section only; no email list.
- Email list tabs — **All** (`?status=all`), **Needs Reply**, **In Progress**, **Closed** — show search + conversation list only; no brief.
- **Sales** tab (`?sales=1`) is gated on `tenant.accountType === "business"`; personal accounts never see it.
- Brief data queries (`commandCenterConversations`, `ignoredStates`, `pendingFollowUps`, `revenueAtRisk`) are skipped when rendering list tabs, making those pages faster.
- Tab active-state logic: Home active when no params; All active on `?status=all`; status tabs active on matching `?status=`; Sales active on `?sales=1`.

Email body rendering and readable-text safety (updated 2026-06-14):

- `lib/email-body.ts` — `isHtmlBody`, `sanitizeEmailHtml` (sanitize-html allow-list, scheme-restricted links/images, enforced `target="_blank" rel="noopener noreferrer"`), `sanitizeEmailHtmlForIframe` (iframe renderer allow-list with scripts/iframes/objects/event handlers removed, links forced to `noopener noreferrer`, image sources limited to `http`, `https`, and `cid`), `linkifyText` (HTML escape, basic markdown rendering, newline→`<br>`, URL auto-link), `renderEmailBodyHtml` dispatcher.
  - Plain-text emails with `**bold**` or `_italic_` markers now render as `<strong>`/`<em>` instead of showing raw markers. Lookbehind guard prevents underscore-in-word false matches.
- `stripHtmlToText` uses `sanitize-html` to remove non-readable HTML (`head`, `style`, `script`, embeds, frames, templates, etc.) before entity decoding and truncation. It also strips plain-text CSS-rule lines and newsletter separator banners so Gmail `text/plain` alternatives do not leak template junk into inbox previews. Inbox snippets, mobile list snippets, explain-thread prompts, and both business/personal draft prompts use cleaned readable text instead of raw HTML/CSS.
- `app/components/EmailBody.tsx` — server component rendering sanitized received HTML in `EmailBodyIframe`; plain text remains linkified and escaped via `dangerouslySetInnerHTML`.
- `lib/email-iframe.ts` / `app/components/EmailBodyIframe.tsx` — sandboxed `srcDoc` iframe renderer for HTML emails. The wrapper injects containment CSS for full-document and fragment emails so wide tables/images/pre/code/links do not create page-level horizontal scrolling or break the parent layout. The iframe now defaults to Gmail-like light rendering: it injects `color-scheme: light only`, removes email `color-scheme` / `supported-color-schemes` meta hints, and strips only dark-mode `@media (prefers-color-scheme: dark)` blocks while preserving normal colored sections and layout CSS.
  - **Iframe rendering fixes (2026-06-16):** (1) Removed `width: auto` from the injected table reset — CSS rules override HTML `width=""` attributes, causing newsletter tables like `<table width="600" align="center">` to lose their fixed widths and appear left-aligned; `max-width: 100% !important` still caps overflow. (2) Added `html { overflow: hidden }` to the injected CSS — prevents the iframe document from growing its own scrollbar; the parent controls iframe height entirely through measured state. (3) Fixed a `ResizeObserver` feedback loop in `EmailBodyIframe`: `setHeight` now uses a threshold guard (ignores changes < 8px) to prevent the observer from triggering re-renders on tiny layout jitter, removed the cumulative `+ 4` buffer that caused creeping height growth, consolidated two separate `load` event listeners (one was leaking on cleanup), and disconnects the observer after 2 seconds so late-loading images are still caught but long-running layout loops cannot form.
  - **Email link handling fix (2026-06-16):** `EMAIL_IFRAME_SANDBOX` now includes `allow-popups-to-escape-sandbox` with `allow-popups allow-same-origin`, while still omitting `allow-scripts` and `allow-top-navigation`. Sanitized links keep `target="_blank" rel="noopener noreferrer"` so email links open as top-level new tabs instead of sandboxed auxiliary contexts that can break tracking redirects. Regression tests cover preserving complex Tailscale/HubSpot-style tracking URLs, final URLs with query params, no double-encoding, and Gmail HTML href storage.
- `app/globals.css` — `.email-body` scoped CSS remains available for plain-text/linkified content: `overflow-wrap: anywhere`, `word-break: break-word`, `max-width: 100%`, image/table/pre/link constraints.
- `app/conversations/[id]/page.tsx` — email thread blocks use `EmailBody`; main section has `min-w-0 overflow-x-hidden` so the sidebar stays visible on desktop even with long/HTML content.
- `lib/google.ts` — Gmail thread sync fetches `threads.get(..., format: "full")` and extracts a canonical body model from the MIME tree: `htmlBody`, `textBody`, `cleanSnippet`, and `renderMode`. The extractor recursively walks nested `multipart/alternative`, `multipart/related`, and `multipart/mixed` payloads, prefers `text/html` for received-email rendering when available, and falls back to `text/plain` for simple messages. `Message.body` remains the storage field for now: HTML messages store renderable HTML so the existing iframe renderer can preserve images/tables/layout; plain-text messages store readable text.
- `fetchGmailSentSamples` still uses the same MIME extraction path but returns readable text/clean snippets only, so reply-style training does not ingest HTML markup.
- Tests in `tests/email-body.test.ts`, `tests/email-iframe.test.ts`, `tests/gmail-sync.test.ts`, `tests/explain-thread.test.ts`, and `tests/ai-draft-provider.test.ts` cover sanitization, unsafe attributes, scheme restriction, plain-text linkification, light-mode iframe wrapping, MIME preference for HTML over CSS-junk plain text, nested multipart HTML extraction, cleaned snippets, and cleaned AI prompt inputs.
- Known gap: external HTTPS images in HTML emails can now survive sync/render safely, but inline `cid:` images are not yet resolved from Gmail attachment parts.

Gmail incremental sync and push notifications (updated 2026-06-15):

- `lib/gmail-sync.ts` is the shared Gmail sync runner for manual sync, OAuth initial sync, and Pub/Sub push notifications. It takes the per-channel database lock, records `lastSyncMode`/`lastSyncStatus`/`lastSyncError`, and prevents duplicate push/manual sync work.
- `lib/google.ts` contains the Gmail API primitives: recent inbox sync, History API incremental sync, watch setup/stop/renewal, and Gmail read writeback.
- `POST /api/connectors/gmail/sync` accepts `incremental: true`; the runner uses incremental sync when a history cursor exists and otherwise does a safe recent sync and stores a fresh cursor.
- `POST /api/connectors/gmail/push?secret=<GMAIL_PUSH_SECRET>` decodes Pub/Sub push payloads and routes the matching Gmail channel through the shared locked runner.
- If Gmail History API rejects an expired/invalid cursor, the runner performs a safe recent sync fallback, refreshes the history cursor, and leaves the user able to sync again.
- `watchGmailChannel` stores the watch response `historyId` and `watchExpiresAt`. `GET /api/cron/gmail-watch` renews only missing/expiring watches; `DELETE /api/cron/gmail-watch` stops a channel watch and clears the cursor/watch expiration.
- `SyncGmailButton` requests incremental sync after the channel has a previous sync timestamp.

Gmail sync controls and inbox refresh polish (2026-06-14):

- `app/components/GmailSyncControl.tsx` exposes a real Gmail sync control in the inbox shell, backed by `POST /api/connectors/gmail/sync`; it never fakes sync state.
- The control shows loading, last-synced time, and inline success/error status. It is shown in the desktop inbox list header and mobile inbox header when a Gmail channel exists.
- Client-side sync triggers now treat healthy Gmail push watches as primary. With a healthy `watchExpiresAt`, app-load/focus sync only runs as a stale fallback; without push/watch health, the previous polling fallback remains. Manual **Sync** always remains available.
- `AutoRefresh` still only refreshes rendered server data; Gmail synchronization itself is handled by the sync API, Gmail push notifications, and the new `GmailSyncControl`.
- Conversation links now preserve inbox filter context through a validated `returnTo=/inbox?...` query. Opening a conversation from **Reply**, **Closed**, search, or Sales preserves the left-list filter and mobile back link.
- The top-left `F` app mark in `AppRail` is now a keyboard/focus-accessible link to `/inbox`.
- The home-page "Safely ignored" list remains collapsible and now previews only a small sample plus a remaining count to avoid duplicating the inbox list.

Gmail sync reliability, local state, and read handling (2026-06-15):

- `POST /api/connectors/gmail/sync` now takes a short database-backed lock on `GmailCredential.syncLockExpiresAt` before syncing. Concurrent requests for the same channel return `202 { skipped: "sync_in_progress" }` instead of racing.
- Gmail sync is idempotent at the thread/message layer. Message upserts tolerate `P2002` unique conflicts caused by overlapping first syncs by confirming the message already exists and continuing. Contact creation has the same race-safe fallback.
- Gmail sync stores raw provider state separately from local state: `Conversation.gmailUnread`, `Conversation.gmailRawState`, and `Message.gmailLabelIds`.
- Local user/read state has first-class fields: `Conversation.userState`, `userStateSource`, `userStateUpdatedAt`, `readAt`, `lastOpenedAt`, and `Message.isRead`.
- Opening a conversation marks it read locally and attempts safe Gmail writeback by removing `UNREAD` from Gmail messages. Gmail writeback failures are logged and do not block the page.
- Marking a conversation closed/done writes a `ConversationState` row with `source: "user_override"` and metadata `{ userOverride: true, userState: ... }`. Deterministic work-item sync will not overwrite that user override, so done conversations do not reappear in Handle First after auto-sync.
- Full sync catches and logs individual thread failures with tenant/channel/thread context and continues syncing other threads. OTP/security codes are not logged.

Email attention classification (2026-06-14):

- `lib/agent/email-classifier.ts` now returns both the legacy `emailType` (`needs_reply`, `notification`, `newsletter`, `marketing`, `fyi`) and a richer `attentionCategory`.
- Supported attention categories are:
  - `needs_reply` — a human likely expects a response.
  - `needs_action` — user should do something but not necessarily reply, such as OTPs, verification codes, password setup/reset links, account confirmation, and calendar RSVP.
  - `review_soon` — security, GitHub token, suspicious login, billing/payment, delivery, or account problem alerts.
  - `read_later` — newsletter/product/update content the user may want to read.
  - `waiting_on` — reserved category for threads where the user is waiting for someone else.
  - `fyi_done` — safe informational or completed transaction email.
  - `quiet` — low-value automated/marketing/noise.
- Deterministic rules run before broad no-reply/domain rules so no-reply transactional emails containing codes, links, account setup, billing, security, or RSVP language are not incorrectly closed as useless.
- The classifier stores `attentionCategory`, `attentionReason`, `attentionConfidence`, action metadata, and optional `expiresIn` in `ConversationState.metadataJson`. OTP/security codes are preserved only in action metadata for direct user display/copy, never auto-used.
- Structured action metadata can include action type, explanation, action link, expiration text, `hasDetectedCode`, and optional `detectedCode`. Action types include OTP code, verify email, confirm account, create password, reset password, login approval, account setup, and security alert.
- `lib/agent/work-item-sync.ts` maps `needs_action` to `waiting_on_you` with high priority, `review_soon` to `risky_urgent` with high priority, and `read_later` to low-priority `fyi_only`; only `quiet` and `fyi_done` are eligible for auto-close.
- `lib/agent/command-center.ts`, the inbox list, conversation detail, and `/api/admin/close-fyi` now prefer `attentionCategory` over the legacy `emailType` when deciding whether something is safely ignorable.
- `PATCH /api/conversations/[id]/attention` is the user-correction path for the right rail and dashboard dismissals. It accepts the same categories shown in the UI (including `needs_reply`), upserts missing `ConversationState` rows, writes `source: "user_override"`, updates `Conversation.status`/`userState` consistently, and preserves prior metadata. The right-rail `AttentionCorrectionSelect` updates optimistically and reverts with an inline error if the update fails.
- `lib/ai/prompts/classify.ts` schema and prompt now include `attentionCategory` and `classificationReason`, keeping LLM classification aligned with deterministic attention categories.
- Tests cover OTP/code extraction, password reset, GitHub token/security alert, newsletter/read-later, human reply request, marketing quiet, LinkedIn job alert quiet, LLM schema normalization, and metadata merge behavior.
- Safety note: FlowDesk extracts verification codes only for immediate user-facing action metadata. It does not auto-use them, and audit payloads do not include raw codes.

Home command-center ranking/dedupe (2026-06-15):

- Home cards expose read state and redacted action metadata through `CommandCenterConversation`.
- Handle First, Needs Action, Waiting On, Read Later, and Quietly Handled sections are mutually exclusive at render-selection time. A thread already selected for a higher-priority section is excluded from lower sections.
- Pure action emails (OTP, verification link, password setup/reset) appear in Needs Action and not also in Handle First. Reply/urgent/opportunity/review-style items can still appear in Handle First.
- Needs Action is expiration-aware. The command center parses explicit phrases such as "expires in 15 minutes" / "24 hours" from action metadata or message text, and falls back to conservative TTLs: OTP/login approval 60 minutes, password/account/reset/verification links 24 hours, and security alerts 48 hours unless wording implies ongoing risk. Expired action items are downgraded to `fyi_only`, removed from Needs Action counts/sections, and counted under Quietly Handled without deleting the email.
- Needs Action cards include a persistent **Not needed** control. It uses the attention correction endpoint to mark the conversation `fyi_done`, immediately hides the card, refreshes server data, and keeps the conversation searchable/viewable.
- Bills & Deadlines skips expired `review_soon` security/billing action alerts so old security/reset items do not linger as current deadlines.
- Handle First cards are now clickable like Needs Action cards, with keyboard activation and child buttons/links stopping propagation.

Home card and right rail UI cleanup (2026-06-15):

- **Card click behavior** — both `HandleFirstSection` and `NeedsActionSection` use the same `role="link"` div pattern: whole card navigates, inner buttons/links stop propagation. Removed the redundant "Open" link inside Handle First cards (card click already navigates). Added consistent hover shadow and border on both card types. Unread cards use `ring-1` accent; read cards use normal weight without dimming.
- **Action metadata on cards** — `CommandCenterConversation.action` fields are now surfaced on both card types: `type` renders as a colored badge (e.g. "Code detected", "Password reset", "Security alert"), `expirationText` renders as a time warning, and `actionLink` renders as an "Open link" button that opens in a new tab (with stopPropagation so clicking the button does not also navigate to the conversation). OTP/code emails show the detected code with a copy button when available; other action types show amber metadata.
- **Duplicate resilience** — `HandleFirstSection` deduplicates by `item.id` before rendering. `NeedsActionSection` accepts an `excludeIds` set (passed by `HomeCommandCenter` containing all Handle First IDs) so the same thread never appears in both sections, even if upstream data has duplicates.
- **Read/unread styling in inbox list** — `AppListColumn` now reads `readAt` and `gmailUnread` from the Prisma query result (both fields were already present in the query's include result; the TS type now includes them). Unread conversations (no `readAt` and not `gmailUnread === false`) show a blue dot and bold name. Read conversations use normal font weight. FYI/quiet threads stay muted but legible, without washing the whole row out.
- **Summary HTML fix** — `buildRelationshipContext` now uses `stripHtmlToText` from `lib/email-body.ts` (instead of the inline `plainBody` helper that only regex-stripped HTML tags). Plain-text emails with embedded CSS rules (`@import`, `body { ... }`, etc.) no longer leak raw CSS into the right rail Summary card. The `stripHtmlToText` function handles both HTML and plain-text-with-embedded-CSS paths.
- **Explain like I'm busy simplified** — `ExplainThreadPanel` no longer renders a full card with a description paragraph before the explanation is loaded. It renders as a compact `w-full` button ("✦ Explain like I'm busy") that sits inline in the right rail between the Summary card and Work items. Once the explanation loads, it expands into a full card with the structured breakdown. This removes visual weight without removing any functionality.
- **Right rail order** — right rail sections are now ordered: Contact → Why this matters (HandleThisPanel, trimmed) → Summary card → Explain like I'm busy button → business panels → Work items (collapsible) → Relationship (collapsible). `HandleThisPanel` now shows only Why this matters, the state badge, the Handle this / Suggest reply button, and Next action. The previously-crowded ContextRows for Person, Summary, Relationship, and Tone have been removed from that panel; Summary is now its own dedicated card using the cleaned `lastConversationSummary` text.

Conversation page layout redesign (2026-06-12):

- `app/conversations/[id]/page.tsx` — two-column grid changed to `lg:grid-cols-[1fr_300px]`; main column is now `section.space-y-4` containing the email thread card and a new inline Reply card below it; sidebar reduced to context-only cards.
- Reply card (bottom of main column) — contains `AIDraftPanel` (inline variant) followed by a "Or send directly" `SendBox` section; the user reads the thread then composes naturally below the last message without hunting through the sidebar.
- `app/components/CollapsibleCard.tsx` — new reusable client component: animated chevron toggle, `defaultOpen` prop, renders children inside a `border-t` content area; used for Work items and Relationship memory in the sidebar.
- `AIDraftPanel` — `inline?: boolean` prop added; when true, skips the outer `rounded-xl border` card wrapper and the "AI draft" title/subtitle (the parent Reply card provides that context); status badge is repositioned inline.
- `WorkItemsPanel` — `bare?: boolean` prop added; when true, skips the outer card wrapper so it renders cleanly inside `CollapsibleCard` without double borders.
- Sidebar order (top to bottom): Contact + Label (combined compact card) → Why this matters (`HandleThisPanel`, trimmed to state badge + handle button + next action) → Summary card (cleaned plain text) → Explain like I'm busy button → Support signals (conditional) → Sales panel (conditional, business only) → Calendar holds → Work items (collapsible, default closed) → Relationship memory (collapsible, default closed).
- Contact and Label merged into one card, eliminating one always-visible sidebar item.
- Sidebar widened from 280px to 300px; main grid gap reduced from 6 to 5.

Email-only thread UI hardening (2026-06-13):

- `app/conversations/[id]/page.tsx` — the message renderer no longer uses left/right chat bubbles. Messages render as full-width email blocks in chronological order with sender, recipient, timestamp, direction badge, and `EmailBody` content.
- Reply composition remains connected to the thread below the messages through a unified `ReplyComposer` that supports manual sending and AI draft generation/review in one textarea.
- Manual sends still call `POST /api/conversations/[id]/send`. AI draft sends still edit/approve the draft, then call `POST /api/conversations/[id]/draft/send-approved`; failed edit/approve/send responses stop the flow and show the server error instead of sending stale content.
- The email-body sanitizer, linkification, iframe wrapping, and layout constraints remain in use through `EmailBody`.

Inbox UX polish, hover actions, and composer redesign (2026-06-15):

- **Wide-screen Home layout** — `HomeCommandCenter` inner container now has `mx-auto` so content centers on wide monitors instead of pinning to the left edge. `HomeHeader` no longer renders `GmailSyncControl` (duplicate removed; inbox list header is the canonical sync-status location).
- **Hover row actions** — `app/components/InboxRow.tsx` is a new client component that wraps each inbox row. On hover, a CSS-driven action strip appears (opacity transition, no dismount race) with optimistic-update buttons: read/unread toggle (`PATCH /api/conversations/:id/read`), attention/tag picker (4-option compact dropdown — Reply needed, Read later, FYI/Done, Quiet — calls `PATCH /api/conversations/:id/attention`, stays open while choosing), and done/reopen toggle (`PATCH /api/conversations/:id/status`). `AppListColumn` passes `attentionCategory` to `InboxRow` for current-state highlighting. Strip stays visible while attention dropdown is open (controlled by `showAttention` state overriding the group-hover class). All three buttons have `title` + `aria-label` for native tooltip and screen-reader support. **Updated 2026-06-16:** replaced dot/checkmark placeholder icons with inline SVG tag and checkmark/reopen icons; added attention dropdown with outside-click-to-close (`useEffect` + `mousedown` listener on `document`).
- **Reply composer collapsed state** — `ReplyComposer` now starts collapsed (compact "Reply to sender…" bar + "Reply" button). Clicking expands an in-place email composer with To (pre-filled from last inbound sender), CC, BCC (toggle buttons → input rows), and Subject (read-only, shows thread ID). The Draft with AI and Send paths are unchanged. Discard collapses back; if the user has typed text without an AI draft, a confirmation prompt prevents accidental loss. CC/BCC capture input but are not yet forwarded to the send API (backend extension point, marked with a TODO comment).
- **Right rail simplification** — when `isAutoEmailConversation` is true (quiet/fyi_done/notification/newsletter/marketing), the right rail shows only the Contact card and the "No reply needed" assistant card. Summary, ExplainThread, WorkItems, Relationship, and CalendarHoldPanel are hidden for those emails. Business panels (SupportPanel, SalesPanel) are unaffected unless `isAutoEmailConversation` overrides the CalendarHoldPanel gate.
- **Email reading padding** — desktop thread scroll area reduced from `px-3 py-4` to `px-2 py-3`; article card inner padding reduced from `px-4 py-3` to `px-3 py-2.5`.

Desktop panel resizing (2026-06-14):

- `app/components/DesktopResizablePanels.tsx` — client-only desktop shell with draggable and keyboard-accessible vertical resize handles. It persists panel widths in `localStorage`, clamps the left inbox list and right context panel to usable sizes, and keeps the center thread at a readable minimum width.
- `app/inbox/page.tsx` — desktop inbox home/list view uses the resizable shell for the left inbox list and main pane; mobile layout is unchanged.
- `app/conversations/[id]/page.tsx` — desktop conversation view uses the resizable shell for left inbox list, center thread/reply area, and right context cards. AppRail remains fixed. Mobile layout is unchanged.
- `app/components/AppListColumn.tsx` — accepts an optional `className` so the same server-rendered list can fill a resizable pane while preserving its fixed default elsewhere.
- Personal accounts hide existing business labels in the thread header/contact card even if old data has a label value.

Personal vs business account separation (updated 2026-06-13):

- `app/conversations/[id]/page.tsx` — reads `accountType` from the NextAuth session (set during login from `Tenant.accountType`); derives account mode through `resolveAccountMode`; gates business-only panels and labels.
- `app/conversations/[id]/LabelSelect.tsx` — accepts `isPersonal` prop; personal accounts see only "No label" (no CRM labels); business accounts see Lead, Reschedule, Pricing, Complaint as before.
- `app/conversations/[id]/WorkItemsPanel.tsx` — accepts `isPersonal` prop; lead card (blue, with stage dropdown and score) is hidden for personal accounts.
- `app/conversations/[id]/AIDraftPanel.tsx` — receives a mode-aware `canSuggest` capability instead of treating business-profile presence as the generic draft gate. Personal accounts can draft without a business profile.
- `app/conversations/[id]/HandleThisPanel.tsx` — receives the same mode-aware suggestion capability.
- `app/inbox/page.tsx` and `app/inbox/CommandCenterPanel.tsx` — personal accounts do not render Sales, Support, Opportunities, lead-score badges, CRM labels, or Revenue at Risk widgets in the normal inbox flow.
- `app/digest/page.tsx` — passes account type into command-center analysis so digest sections do not classify personal conversations as sales/support opportunities.
- `app/settings/page.tsx` — Follow-Up Automation copy says quiet conversations for personal accounts and quiet leads for business accounts.
- `lib/agent/command-center.ts` — accepts account type for analysis. Opportunity, support, and sales-qualified states are business-only; sensitive email signals still override auto-email classification for both modes.
- `lib/agent/work-items.ts` and `lib/agent/work-item-sync.ts` — personal accounts still get state/task/person-memory sync, but deterministic lead extraction, support classification, sales classification, lead scoring, and lead audit records are business-only.
- `app/api/conversations/[id]/draft/suggest/route.ts` — personal draft metadata forcibly stores `suggestedLabel: null` and never writes business labels to the conversation.
- `lib/ai/prompts/draft-reply.ts` — personal draft prompt tells the model to keep `suggestedLabel` null instead of listing business labels.
- `lib/agent/command-center.ts` — `bodyText` strips HTML from HTML email bodies before pattern matching using an internal `plainBody` helper. `lastConversationSummary` in `buildRelationshipContext` now uses `stripHtmlToText` from `lib/email-body.ts` so the right rail Summary card never shows raw HTML/CSS/template markup, including plain-text emails with embedded CSS rules.
- Tests: `tests/work-item-sync.test.ts` covers personal accounts not creating lead records; `tests/ai-draft-provider.test.ts` covers personal draft prompt label separation; command-center tests cover account-mode-safe behavior and sensitive override.

Limitations:

- Personal accounts have no configurable label set yet; CRM labels are hidden rather than replaced. A future slice can add a personal label taxonomy (e.g. To-do, Waiting, FYI).
- The `isPersonal` flag is derived from session at render time; no separate UI exists to switch account type without an admin re-seed.

### AI Drafting

- OpenAI-backed draft generation.
- Structured draft prompt and parser.
- Business-profile and knowledge-document context.
- Learned reply profile support.
- AI draft panel on conversation pages.
- Optional rough user instructions in the AI draft panel ("say yes but only next week") are passed into draft generation and stored in draft metadata as `userInstruction`.
- Draft save, clear, approve, and approved-send flows.
- Draft metadata stores intent, confidence, risk, suggested label, escalation reason, model, prompt version, and context IDs.

### Agent Pipeline

- `AgentJob`, `AgentToolCall`, and `ApprovalRequest` models exist.
- Agent job creation and execution helpers exist under `lib/agent/`.
- Classification, policy checks, availability checks, calendar holds, follow-up batch logic, and autopilot guardrails exist.
- Autopilot settings exist, but category-level autopilot modes are not complete.

### Business And Personal Context

- Business profile settings exist.
- Knowledge document create/list/delete flows exist.
- Personal/learned reply profile infrastructure exists.
- Relationship memory is persisted per contact in `PersonMemory` (summary, preferences, open questions, promised actions) and updated automatically after conversation sync.

### Daily Command Center

First slice implemented:

- `lib/agent/command-center.ts`
- `app/inbox/CommandCenterPanel.tsx`
- `app/digest/DailyBriefSections.tsx`
- `app/conversations/[id]/HandleThisPanel.tsx`
- `tests/command-center.test.ts`

Current behavior:

- Computes needs-reply, waiting, scheduled, risky, opportunity, done, and FYI states.
- Shows a command center on `/inbox`.
- Shows a fuller brief on `/digest`.
- Adds assistant context and a "Handle this" button on conversation pages.

Limitation:

- Some command-center data is persisted through `ConversationState`, but the rendered brief still recomputes several rollups and rankings at request time.

### Task, Lead, And Approval Foundations

First slice implemented:

- `ConversationState`, `InboxTask`, and `Lead` models.
- deterministic extraction helpers in `lib/agent/work-items.ts`.
- tenant-scoped persistence sync in `lib/agent/work-item-sync.ts`.
- approval queue page at `/approvals`.
- conversation sidebar work-items panel.
- tests in `tests/work-items.test.ts` and `tests/work-item-sync.test.ts`.

Review actions and background sync slice implemented:

- `app/api/tasks/[id]/status/route.ts` — PATCH to close or reopen a task.
- `app/api/leads/[id]/stage/route.ts` — PATCH to update lead stage.
- `app/api/approvals/[id]/decide/route.ts` — POST to approve or reject an approval request.
- `app/tasks/page.tsx` — task list page with overdue/upcoming/undated grouping.
- `app/leads/page.tsx` — leads pipeline page sorted by score.
- `app/approvals/ApprovalActions.tsx` — client component with inline approve/reject buttons.
- `app/approvals/ApprovalList.tsx` — client component with draft previews, bulk decisions, and guarded row removal after successful mutations.
- `WorkItemsPanel.tsx` — now a client component with task close button and lead stage dropdown.
- `lib/google.ts` and `lib/microsoft.ts` — `syncConversationWorkItems` called after each conversation upsert during Gmail and Outlook sync.
- Inbox nav now includes Tasks and Leads links.
- Tests in `tests/work-item-actions.test.ts`.

Phase 1 completion slice implemented (commit `0e5926a`):

- `PersonMemory` Prisma model: per-contact persisted memory with summary, preferences, open questions, promised actions, last contact, and message count.
- `lib/agent/person-memory.ts` — deterministic extraction from up to 10 recent conversations (30 messages each); synced automatically from `lib/agent/work-item-sync.ts` after every conversation sync, with an audit-log entry per sync.
- Relationship panel on conversation pages showing summary, promises made, open questions, and preferences.
- `app/api/tasks/[id]/due/route.ts` plus inline due-date editing on `/tasks` (`app/tasks/TaskList.tsx`) — click a date to edit, Enter/Escape/blur to save.
- Approval queue draft preview — each queue item can expand to show the draft text inline.
- Batch select with bulk approve/reject on the approval queue via `app/api/approvals/bulk/route.ts`.
- Follow-up tracker panel on `/inbox` — amber banner listing queued follow-up agent jobs.
- "Safely ignored" collapsible section on `/inbox` driven by `ConversationState` safely-ignored metadata.

Lead follow-up sequences slice implemented:

- `lib/agent/lead-sequence.ts` — three-step sequence (first follow-up after 2 quiet days, second after 4 more, closing after 7 more) for leads in `new`/`contacted`/`qualified` stages.
- Sequence state stored in `Lead.metadataJson.followUpSequence`; no schema change.
- Due steps create `AgentJob` records with trigger `lead_follow_up` (no OpenAI calls from cron; drafting stays on-demand), deduped per conversation per 24h, audited as `lead_sequence.step_queued`.
- Sequence pauses automatically when the lead replies (inbound last message) and stops for `won`/`lost` leads or closed conversations.
- Cron endpoint `GET /api/cron/lead-sequence` protected by `CRON_SECRET`.
- `/leads` rows show sequence progress; the inbox follow-up tracker includes `lead_follow_up` jobs.
- Tests in `tests/lead-sequence.test.ts`.

Weekly value report slice implemented:

- `lib/agent/value-report.ts` — rolling 7-day tenant-scoped counts (drafts created/sent, tasks extracted/closed, leads detected, follow-ups queued, approvals decided, conversations triaged) plus a conservative time-saved estimate (4 min/draft, 3 min/follow-up, 2 min/task, 5 min/lead; nothing double-counted).
- `/reports` page with headline sentence, metric cards, and time-saved card; estimate weights shown transparently in the UI.
- Reports link in the inbox desktop nav and mobile nav strip.
- Computed live from existing records — no new model, no migration, no tracking pipeline.
- Tests in `tests/value-report.test.ts`.

Explain This Thread slice implemented:

- `lib/ai/prompts/explain-thread.ts` — prompt builder (last 25 messages, per-message truncation, direction labels, no-invented-facts and no-liability-admission safety rules), strict JSON schema, tolerant normalizer.
- `explainThreadWithOpenAI` / `explainThread` in `lib/ai/openai.ts` and `lib/ai/provider.ts`, mirroring the draft-reply structured-output pattern.
- `POST /api/conversations/[id]/explain` — tenant-scoped; records `AiUsageEvent` (feature `explain_thread`) on success and failure and writes a `conversation.explained` audit entry with risk level and counts.
- `ExplainThreadPanel` on conversation pages — compact "✦ Explain like I'm busy" button in the right rail. On click: what happened, what they want, what you need to do, risks/deadlines with a low/medium/high risk badge, suggested next step, refresh. Renders as a button until triggered; expands to a structured card on load.
- Read-only by design: never drafts, sends, or mutates state. Explanations are generated on demand and not persisted.
- Works for both personal and business accounts (no business-profile requirement).
- Tests in `tests/explain-thread.test.ts`.

AI usage policy and cost controls (2026-06-15):

- `lib/agent/ai-usage-policy.ts` is the shared deterministic gate for expensive AI work. It classifies low-value automated mail such as OTPs, password resets, verification links, receipts, newsletters, marketing, LinkedIn job alerts, GitHub/security notifications, and quiet/FYI messages before any rich LLM work is considered.
- Gmail/Outlook sync keeps work-item extraction and deterministic attention classification, but rich relationship-memory extraction is skipped for Tier 0/Tier 1 automated or low-value emails. High-value human, reply/action, VIP, and business-critical threads still qualify for richer AI.
- Conversation detail uses deterministic state sync on open with `enableRichAi: false`, so opening the same thread does not eagerly regenerate relationship intelligence.
- `syncPersonMemoryWithLLM` caches by content hash, prompt version, source, and model on `PersonMemory`; unchanged eligible conversations reuse the previous result and record a `person_memory.cache_hit` usage event instead of calling the model.
- Manual draft suggestions cache by prompt version, account mode, conversation content, reply context, and user instructions in `Draft.metadataJson.draftCacheKey`. Repeating the same suggestion request returns the existing draft and records `draft.suggest.cache_hit`.
- Agent classification, draft suggestion, and person-memory paths record `AiUsageEvent` entries for success, skipped/cache-hit, and failure cases so token/cost behavior can be measured without adding fake analytics.
- Right-rail expensive work remains lazy: Explain This Thread is generated only after the user clicks the button and is not persisted; reply suggestions are generated only through explicit user action.

Email Risk Radar slice implemented (2026-06-12, Phase 1):

- `lib/agent/risk-radar.ts` — pure deterministic scanner for deadline-soon, final-notice, unanswered-thread, and sensitive-content signals.
- `/risk-radar` page — tenant-scoped, read-only grouped view of the latest 200 conversations with summary counts and conversation links.
- Business inbox navigation includes Risk Radar in the secondary menu.
- No schema changes; computes live from existing conversation messages, draft metadata, labels, and status.
- Tests in `tests/risk-radar.test.ts` and `tests/client-navigation.test.ts`.

Current behavior:

- Opening a conversation syncs deterministic state and open tasks. Business accounts also sync a lead record when the thread has matching business signals.
- Gmail and Outlook sync now also triggers work-item sync for each imported conversation (background, fire-and-forget).
- Tasks can be closed from the conversation sidebar and due dates can be edited from `/tasks`.
- Business leads can be moved through stages (new → contacted → qualified → won → lost) from the conversation sidebar or `/leads`.
- Approval queue supports inline approve/reject decisions, bulk decisions, and inline draft previews without navigating to the conversation.
- Tasks are extracted from promise, deadline, payment, invoice, and renewal language.
- Leads are extracted from pricing, demo, setup, and booking language for business accounts only.
- Contacts get persisted `PersonMemory` after sync, surfaced as a relationship panel on conversation pages. Deterministic memory still runs broadly; richer LLM memory extraction is gated by the AI usage policy and cached by content hash.
- The inbox shows queued follow-up jobs and a collapsible safely-ignored section.

Meeting prep + post-meeting follow-up slice implemented (2026-06-11, Phase 2):

- `POST /api/meetings/prep` — on-demand brief from PersonMemory + recent email threads; returns context, talking points, and suggested goal.
- `POST /api/meetings/follow-up` — notes + prior threads → follow-up draft queued as `ApprovalRequest`; falls back to inline copy if no prior conversation.
- `/meetings` page with on-demand briefing form and follow-up generator.
- Meetings-today section in the digest.
- No schema changes; reuses existing calendar credentials, PersonMemory, and ApprovalRequest infrastructure.

Lead intelligence + CRM pipeline slice implemented (2026-06-11, Phase 2):

- `lib/ai/prompts/lead-scoring.ts` — prompt builder, JSON schema, and output normalizer for LLM-based scoring (score 1–100, explanation, estimated value, need, urgency, budget clue).
- `lib/agent/lead-scoring.ts` — `shouldRescoreLead` guard (skips when conversation unchanged since last score) and `scoreLeadForConversation` orchestrator; writes score, scoreExplanation, estimatedValue, scoredAt, need, urgency, budgetClue to the Lead record and creates an audit entry.
- `lib/agent/work-item-sync.ts` — fires `scoreLeadForConversation` as fire-and-forget after every lead upsert; heuristic score is preserved if LLM call fails.
- `POST /api/leads/[id]/score` — on-demand re-score endpoint; bypasses the stale-guard with `force: true`.
- `/leads` page — pipeline funnel header with per-stage counts and estimated value totals; color-coded score badge (green ≥70 / amber ≥40 / gray); scoreExplanation shown as italic subtitle; estimatedValue shown inline; RescoreButton client component for on-demand re-score.
- Command center — opportunity cards use `lead.scoreExplanation` as the reason text; lead score badge shown alongside the priority badge on high-intent opportunity cards.
- Tests in `tests/lead-scoring.test.ts`.

v2.1: Knowledge Base Source Management + Customer Support Mode (2026-06-12):

- `prisma/schema.prisma` — `sourceUrl String?` and `crawledAt DateTime?` added to `KnowledgeDocument`; `"webpage"` added to valid source types.
- `POST /api/knowledge-documents/crawl` — server-side URL fetch with SSRF prevention (https-only, no private IPs, 172.16/12 + IPv6 blocked), 10s timeout, HTML-to-text stripping, 8000-char truncation. Creates `KnowledgeDocument` with `sourceType: "webpage"`.
- `/knowledge-base` management page — URL import form, document list with source-type badge and word count, delete. Business accounts only.
- `lib/agent/support-classifier.ts` — `classifySupportSignals` pure function: detects support, churn risk, escalation need, and best KB-doc match by keyword overlap.
- `lib/agent/work-item-sync.ts` — runs support classification fire-and-forget after each sync; writes `isSupport`, `churnRisk`, `needsEscalation`, `suggestedKbDocId` into `ConversationState.metadataJson`.
- `lib/ai/prompts/draft-reply.ts` — `citedDocumentIds: string[]` added to schema, result type, and prompt. Doc IDs now included in knowledge-section format.
- `app/conversations/[id]/SupportPanel.tsx` — shows Support / Churn Risk / Needs Escalation badges, KB suggestion with "Use this answer", repeat-contact count.
- `app/conversations/[id]/AIDraftPanel.tsx` — citation chips below draft text; clicking a chip shows KB doc content in a popover.
- `app/inbox/page.tsx` + `CommandCenterPanel.tsx` — Support count chip in command center grid; Support filter tab in inbox.
- `lib/agent/command-center.ts` — `"support"` state; churn-risk threads get `urgent` priority; `counts.support` and `sections.support`.

v2.2: Sales Agent Mode + Mini CRM Pipeline Reporting (2026-06-12):

- `lib/agent/sales-classifier.ts` — `classifySalesSignals` pure function: detects budget/timeline/proposal/closing signals via regex, infers stage (prospect → qualified → proposal → closing), extracts dollar budget and timeline phrase, returns `suggestedAction` from a static action map.
- `lib/agent/work-item-sync.ts` — runs sales classification after every sync; writes `isSalesLead`, `closingStage`, `extractedBudget`, `extractedTimeline`, `suggestedAction` into `ConversationState.metadataJson` alongside support signals (spreads preserve both).
- `lib/agent/command-center.ts` — `"sales_qualified"` state (score boost 35, takes priority over `"opportunity"`); `counts.salesQualified` and `sections.salesQualified`.
- `app/conversations/[id]/SalesPanel.tsx` — shows stage badge (color-coded), budget, timeline, suggested action, and "Generate closing draft" CTA.
- `app/conversations/[id]/page.tsx` — both `SupportPanel` and `SalesPanel` wired into conversation sidebar; metadataJson parsed for both support and sales signals; KB doc fetched when `suggestedKbDocId` present.
- `app/inbox/CommandCenterPanel.tsx` — Support and Sales Qualified count chips added to command center grid.
- `app/inbox/page.tsx` — `?sales=1` filter tab; `stateRecord` mapped to `conversationState` before `buildDailyCommandCenter` so both `isClassifiedSupport` and `isSalesQualified` helpers read correctly.
- `app/leads/page.tsx` — score/stage filter form with Clear link; week-over-week stats table (new leads + avg score); dynamic section titles when filters active; `allLeads`/`displayLeads` split so funnel always shows totals.

Conversation page layout and UX polish (2026-06-12):

- `app/conversations/[id]/page.tsx` — page-level max width widened from `max-w-5xl` (1024px) to `max-w-[1200px]`; applies to both the header bar and the main grid; sidebar column widened from 300px to 320px; grid gap increased from 5 to 6. On a typical 1440px desktop the main email column gains ~170px, eliminating the empty-canvas feeling.
- `app/conversations/[id]/page.tsx` — `isPersonal` is now forwarded to `AIDraftPanel` and `HandleThisPanel` (previously only passed to `LabelSelect` and `WorkItemsPanel`).
- Text overflow hardening: `min-w-0 overflow-hidden` added to sidebar Contact card, the "No reply needed" auto-email card, and `HandleThisPanel` outer div; `break-words [overflow-wrap:anywhere]` added to `HandleThisPanel` `ContextRow <dd>`, `ContextList <li>`, the Relationship memory content block, and `CollapsibleCard` inner content; header email address line uses `break-all` to handle bare email/thread addresses.
- `app/conversations/[id]/AIDraftPanel.tsx` — `isPersonal?: boolean` prop added (default `false`); setup warning style changed from amber to neutral slate (less visually dominant when the card is in a disabled state); instruction textarea reduced from `rows={2}` to `rows={1}`; draft textarea uses `rows={hasDraftText ? 6 : 3}` — collapses when empty, expands once a draft exists. Draft availability is now governed by mode-aware `canSuggest`.
- `app/conversations/[id]/HandleThisPanel.tsx` — `isPersonal?: boolean` prop added (default `false`); `ContextRow` and `ContextList` get `min-w-0 break-words [overflow-wrap:anywhere]` for long summaries and bare URLs; outer card gets `min-w-0 overflow-hidden`. Draft availability is now governed by mode-aware `canSuggest`.
- `app/components/CollapsibleCard.tsx` — inner content div gets `min-w-0 break-words [overflow-wrap:anywhere]` so all collapsible card content is overflow-safe.

AI Classification Quality improvements (2026-06-12):

- `lib/agent/email-classifier.ts` — deterministic email-type classifier; pure function with no DB or AI calls; classifies emails as `needs_reply`, `notification`, `newsletter`, `marketing`, or `fyi` using no-reply local-part patterns, known notification/Google/Microsoft domains, subject patterns, newsletter body patterns, and marketing subject patterns.
- `lib/agent/reply-learning.ts` — `trainLearnedReplyProfile` now falls back to Gmail SENT history (up to 60 messages) when fewer than 5 DB outbound samples exist; fetches from `lib/google.ts:fetchGmailSentSamples`; requires ≥5 total samples; result includes `fromDb`/`fromGmail` counts in `sourceStatsJson`.
- `lib/google.ts` — `fetchGmailSentSamples(channelId, limit)` added; calls Gmail API with `labelIds: ["SENT"]`; returns `Array<{ text, createdAt }>`; does not write to DB.
- `lib/ai/prompts/classify.ts` — `buildClassifyPrompt` now accepts `accountType`; personal accounts get a separate prompt focused on personal communication, no CRM labels, no lead/sales framing; business accounts get the existing prompt unchanged.
- `lib/agent/jobs.ts` — `_executeJob` fetches `tenant.accountType` and passes it to `classifyConversation`, so personal accounts never receive the sales/lead classify prompt.
- `lib/agent/work-item-sync.ts` — gates `scoreLeadForConversation` and `classifySalesSignals` behind `!isPersonal`; runs `classifyEmailType` on the first inbound message and stores `emailType` in `ConversationState.metadataJson` when type is not `needs_reply`.
- `lib/agent/command-center.ts` — `getEmailType`/`isAutoEmail` helpers read `conversationState.metadataJson.emailType`; `isSafelyIgnorable` returns true for auto-emails; `analyzeConversationForCommandCenter` overrides state to `fyi_only`/priority `none` for notification/newsletter/marketing emailType (after sensitive check, before churn-risk check).
- `app/conversations/[id]/page.tsx` — passes `conversationState` to `assistantInput`; derives `isAutoEmailConversation`; renders a simple "No reply needed" card instead of `HandleThisPanel` when emailType is notification/newsletter/marketing.
- Tests: `tests/email-classifier.test.ts` (15 tests), `tests/reply-learning.test.ts` (3 new tests), `tests/agent-job-pipeline.test.ts` (3 new tests for personal/business/null prompt), `tests/work-item-sync.test.ts` (tenant mock added), `tests/command-center.test.ts` (4 new tests for emailType override). Total: 374 tests passing.

Bug fixes and hardening (2026-06-13):

- **Channel disconnect cascade** — `Conversation` now has `onDelete: Cascade` on its `Channel` foreign key; all children (`Message`, `Draft`, `ApprovalRequest`, `AgentJob`, `CalendarHold`) cascade from `Conversation`. Disconnecting a Gmail or Outlook account cleanly removes all associated data. Migration: `prisma/migrations/…/migration.sql`.
- **Gmail reconnect tenant re-assignment** — if a Gmail address previously connected under a different tenant is reconnected, the `Channel.tenantId` is updated so the settings page reflects the correct tenant.
- **FYI auto-close second pass** — `work-item-sync.ts` runs a second-pass auto-close after `classifyEmailType` so emails the pattern matcher missed (emailType set after state was initially saved) are caught and marked closed.
- **Auto-email classifier hardening** — `isSensitive` and `isOpportunity` in `command-center.ts` short-circuit on auto-emails; `isSafelyIgnorable` checks automated body/sender patterns before the sensitive guard; `email-classifier.ts` adds LinkedIn, Target, common social/edu/marketing domains, and a subdomain pattern for `em./e./email.` senders.
- **Digest page stateRecord** — `app/digest/page.tsx` now includes `stateRecord` in its Prisma query so `isAutoEmail()` reads correctly on the full brief page.
- **FYI badge suppression** — inbox and detail pages correctly suppress FYI badges using `metadataJson.emailType` in addition to `stateRecord.state` and body/sender patterns.
- **Draft prompt RAG/summarization** — draft generation now builds a structured conversation summary, sends only the five most recent messages, and selects the most relevant knowledge documents for business prompts instead of always sending up to 20 long raw messages. The draft route and autopilot both pass conversation/contact IDs into reply context so prompt generation can fetch related state and memory.

Phase 1 gaps + Phase 2 concierge templates slice (2026-06-15):

- **Richer sensitive detection** (#10) — `lib/agent/sensitive-classifier.ts` expanded to legal, immigration, tax, medical, HR, and emotional categories. Risky snippet highlighted in the AI draft panel.
- **Confidence policy thresholds** (#29) — `AutopilotSetting.categoryThresholdsJson Json?` field (migration applied). Per-category threshold gate in `lib/agent/autopilot.ts` with case-insensitive intent lookup. Settings UI in `/settings` for map of intent→threshold; server-side validation [0.5, 1.0].
- **Smart labels taxonomy — product-complete UI** (#42) — attention filter tabs (Reply/Review/Later) on `/inbox` via `?attention=` param. `AttentionCorrectionSelect` client dropdown on conversation pages. `PATCH /api/conversations/[id]/attention` route with tenant isolation and audit log. `BulkCloseButton` and `POST /api/conversations/bulk-close` for quiet/fyi_done batch close.
- **Command-center bills & deadline signals** (#1) — `BillSignal`/`BillsSection` types and `buildBillsSection` in `lib/agent/command-center.ts`. Bills & Deadlines card (amber-accented) in `HomeCommandCenter` driven by `InboxTask.dueAt`, sorted ascending, capped at 8.
- **Trust UX: Why + Undo** (#44) — Why/Undo columns on `/audit` page. `POST /api/audit/[id]/undo` reverts `autopilot.draft_approved` actions: tenant-isolates draft update, writes undo audit log with original `conversationId`.
- **Manual task creation** (#13) — `POST /api/tasks` route with `source: "manual"`, idempotent `deterministicKey` with random suffix, `isNaN` guard on `dueAt`. `ManualTaskForm` and `WorkItemsPanel` "+ Add task" toggle on conversation pages.
- **Person-memory editing + LLM upgrade** (#5) — `PersonMemoryEditShell`/`PersonMemoryEditPanel` client forms. `PATCH /api/person-memory/[contactId]` partial-update route. `syncPersonMemoryWithLLM` LLM extraction with `gpt-5.4-mini`; skips low-value email via the AI usage policy, caches by content hash/source/model, and falls back to regex heuristic on <3 messages, no API key, cache-skip, or LLM error. `[RELATIONSHIP_DATA: ...]` bracketing on personMemory fields in meeting-prep and meeting-follow-up prompts for prompt-injection mitigation.
- **Local-business concierge templates** (#36) — 8 templates across 6 categories in `lib/agent/concierge-templates.ts`. `POST /api/settings/seed-templates` idempotent seed (business-only). `ConciergeTemplateSeedButton` in `/settings`. Template picker in `ReplyComposer`. Concierge templates excluded from AI reply context via `sourceType: "concierge_template"` filter in `lib/agent/reply-context.ts` and `lib/agent/context.ts`.

Gmail archive and trash actions (2026-06-16):

- **Gmail API methods**: `archiveGmailThread(channelId, gmailThreadId)` removes the `INBOX` label via `threads.modify`; `trashGmailThread(channelId, gmailThreadId)` moves to Gmail Trash via `threads.trash`. Both are thread-level operations. Neither permanently deletes mail.
- **`PATCH /api/conversations/[id]/archive`** — provider-gated (returns 400 for non-Gmail channels); calls Gmail writeback, then closes the conversation locally and upserts `ConversationState` with `source: "user_override"` + `archivedAt` metadata so sync never reopens it.
- **`PATCH /api/conversations/[id]/trash`** — same pattern, calls `threads.trash`, writes `trashedAt` metadata.
- Both routes read and merge existing `metadataJson` before writing, preserving attentionCategory and other user signals.
- **`app/components/InboxRow.tsx`** — accepts `isGmail: boolean` prop; renders an archive icon button in the hover strip for Gmail conversations. On API failure, the icon turns red with an error tooltip and status is rolled back.
- **`app/components/AppListColumn.tsx`** — adds `channel: { select: { provider: true } }` to the Prisma include and passes `isGmail={conv.channel.provider === "google"}` to each `InboxRow`.
- **`app/conversations/[id]/ThreadStatusHeader.tsx`** — accepts `isGmail: boolean` prop; adds an "Archive" button and a "···" (More) button for Gmail conversations. The More menu contains "Move to trash" with an inline confirmation step before the destructive write. Errors from both actions surface inline next to the buttons and roll back optimistic status. Outside-click dismisses the menu.
- **`app/conversations/[id]/page.tsx`** — passes `isGmail={conversation.channel.provider === "google"}` to `ThreadStatusHeader`.
- **Outlook and other providers**: archive and trash UI is hidden because the routes return 400 for non-Google channels. No broken actions are shown.
- **Tests**: `tests/gmail-archive-trash.test.ts` — 8 tests covering correct API call shape, mutual exclusion (archive does not call trash and vice versa), missing-credential error, and Gmail API error propagation.

Inbox preview text improvements (2026-06-16):

- `prisma/schema.prisma` — `Message.subject String?` field added; migration at `prisma/migrations/20260616000000_add_message_subject/`.
- `lib/google.ts` — `upsertGmailMessage` now stores `msg.subject` on the `Message` row at create time (existing messages will have `null` until re-synced).
- `lib/email-body.ts` — `buildPreviewText(subject, bodySnippet, maxLength?)` helper: combines subject + snippet with `" — "` separator, deduplicates when snippet text starts with the subject text (or vice versa), and truncates to 90 chars.
- `app/components/AppListColumn.tsx` — inbox rows now show `buildPreviewText(message.subject, strippedBody)` instead of raw stripped body. Tim Ferriss newsletters now show "New from Tim — '...' — Plus: ..." instead of starting mid-article. Messages without a stored subject fall back to body-only preview.

Personal/business email action split (2026-06-16):

- **Product rule**: Close/Reopen is a business workflow concept. Personal accounts treat read/unread as their primary state management tool; Close/Reopen adds confusion rather than value.
- **`app/components/InboxRow.tsx`** — accepts new `isPersonal: boolean` prop. The Done/Reopen quick action button is hidden for personal accounts (`!isPersonal` guard). Business accounts retain the close (checkmark) and reopen (circular arrow) icons in the hover strip.
- **`app/components/AppListColumn.tsx`** — computes `isPersonal` via `resolveAccountMode(accountType)` and passes it to each `InboxRow`.
- **`app/conversations/[id]/ThreadStatusHeader.tsx`** — the "Close"/"Reopen" button is now wrapped in `!isPersonal`. Personal accounts see only "Mark unread" / "Mark read". Business accounts retain both buttons.
- **`app/conversations/[id]/page.tsx`** — mobile header `StatusButton` is now wrapped in `!isPersonal` so mobile personal accounts also only see the read/unread action.
- Archive and delete were intentionally deferred: no Gmail write-back exists for archive/trash yet. Adding UI before a safe durable backend path would create orphan state.

Link and dashboard stale-action hardening slice (2026-06-16):

- **Email link reliability** — Gmail HTML hrefs are preserved end-to-end, including provider tracking URLs and final URLs with query params. Sanitizers do not double-encode query strings. Email iframe links open in top-level new tabs via `allow-popups-to-escape-sandbox` while scripts and top navigation remain blocked.
- **Attention correction persistence** — right-rail attention changes now update `Conversation.status`, `Conversation.userState`, and `ConversationState` through a user override. Missing state rows are upserted instead of returning 404, so corrections persist after refresh and propagate to list labels and dashboard counts.
- **Expired action cleanup** — Needs Action and Bills & Deadlines now drop expired OTP/reset/login/security items using explicit expiry text when present plus default TTLs. Expired items move to quietly handled/fyi-only behavior without deleting the email.
- **Manual dashboard dismissal** — Needs Action cards have a **Not needed** control that persists through `PATCH /api/conversations/[id]/attention` as `fyi_done`, hides the card immediately, and refreshes the dashboard.

Limitations:

- Lead sequence step timings are fixed (2/4/7 days); there is no settings UI yet.
- Batch re-scoring of all existing leads is not implemented; scoring runs per lead after each sync.
- Risk Radar thresholds are deterministic and not user-configurable yet.
- URL crawl is single-page only (no sitemap, no re-crawl scheduling).
- KB matching uses keyword overlap, not semantic/embedding search.
- No ticket numbering, SLA tracking, or team assignment (Phase 5).

## Partial Features

These exist in some form, but are not product-complete:

- Daily Command Center.
- Handle This button.
- Follow-up brain.
- Relationship memory (editing shipped; LLM extraction shipped with heuristic fallback).
- Knowledge-base replies.
- Personal style matching.
- Sensitive/risky email detection (expanded categories shipped; no settings UI for thresholds).
- Smart scheduling.
- Approval infrastructure.
- Confidence metadata and policy (per-category thresholds shipped; broader policy builder Phase 4).
- Action-oriented labels (attention categories + correction UI shipped; personal label taxonomy not yet added).
- Trust/audit infrastructure (Why + Undo shipped for autopilot; broader action types pending).
- Autopilot settings (global + per-category thresholds shipped).
- Persisted conversation state.
- Task extraction (manual creation shipped; assignment not yet).
- First-pass lead capture.
- Approval queue.
- Command center source signals (Bills & Deadlines card shipped; meetings-needing-prep calendar events pending).
- Local-business concierge templates (seed + picker shipped; template editing not yet).

See `MASTER_PRODUCT_PLAN.md` for phase recommendations and feature statuses.

## Not Yet Implemented As Product Features

- Full CRM pipeline.
- Full pipeline trend analytics and value forecasting (score/stage filters and WoW stats table shipped in v2.2; deeper forecasting not yet built).
- Task assignment.
- Attachment intelligence.
- Natural-language inbox search.
- Ask My Inbox chat.
- Team inbox collaboration.
- Personal life admin mode (broader bill/travel/school/medical/subscription flows and privacy UX).
- Phishing/scam/fraud protection.
- Auto-unsubscribe.
- Outcome-based automation.
- Plain-English rule training.
- Multi-step workflows.
- VIP protection.
- Smart snooze.
- Broad connected-app context.
- Auto-generated playbooks/snippets.
- Second-brain retrieval.
- Auto-personalized outreach.
- One-click Clean My Inbox onboarding.

## Deferred Or Removed

### SMS / Twilio

Twilio and SMS are deferred. The product direction is email-first. Old SMS-first assumptions should not drive new code, docs, or onboarding. If SMS returns later, it should be based on customer demand and should get a fresh spec.

### Old Stacked PR Handoff

The AI Draft MVP PR handoff was removed. The feature is now part of the baseline product and should be documented through this current-state file, tests, and code references rather than old merge instructions.

## Recommended Next Engineering Slice

All Phase 1 gaps and the remaining Phase 2 concierge-templates item are now shipped. The natural next slice is Phase 3 (Personal Chief of Staff) — see `docs/TODO.md` for the full roadmap. Within Phase 3, highest-ROI items:

1. VIP protection (#33) — priority override for known important senders.
2. Smart snooze / reply-later (#34) — schedule a conversation for later with auto-reminder.
3. Personal life admin mode (#21) — broader bill/travel/school/medical/subscription flows.

See `docs/TODO.md` for the full remaining-work roadmap mapped against the master plan.

## Verification Baseline

Recent verification (2026-06-16, after preview text + action split + persistence fixes):

```bash
npm test
npx tsc --noEmit
```

Observed result:

- `npm test`: 517 tests passed across 49 files.
- `npx tsc --noEmit`: no errors.

Browser smoke-test note:

- Production build server rendered `http://localhost:3100/login` with the expected email/password fields and no framework overlay.
- Authenticated conversation-thread visual QA was not completed because the browser session had no logged-in account/conversation data. `next dev` was also unreliable in this environment due local `EMFILE` watcher limits, so the smoke check used `next start` after a successful production build.
