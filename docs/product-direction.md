# FlowDesk Product Direction: Gmail-Native AI Email Operator

## Summary

FlowDesk is a Gmail-native AI email operator with a polished companion web app.

The product promise:

> FlowDesk works inside your existing Gmail to label, prioritize, draft, follow up, and organize email automatically. Keep using Gmail like normal; FlowDesk handles the busywork in the background.

**Two surfaces, one bar for quality:**

- **Gmail is the primary surface.** Most users will interact with FlowDesk almost entirely *through Gmail* — its labels, its drafts, its follow-up nudges. So the Gmail-native side has to work *really well*: when FlowDesk says it labeled a thread, that label is on the thread in Gmail; when it drafts a reply, the draft is there. This is the product.
- **The web app is the secondary surface, held to a high quality bar.** It is where users connect Gmail, supervise the agent, approve actions, train writing style, and do the occasional deeper review. Most users won't live here — but it must still *work correctly* and *look good*. "Secondary" means smaller in daily footprint, not lower in quality. We take direct design and implementation inspiration from Inbox Zero, Tom Shaw's AI agent inbox, and the other reference projects (`docs/reference-research/`), copying patterns and code where it helps.

> **Current focus (set 2026-07-07): the trustworthy core loop.** Before adding features, the loop *classify → act in Gmail → reflect state truthfully in the UI* has to be reliable. Two known failures make FlowDesk feel broken today and are the top priority (see `docs/TODO.md`): (1) labels are created in Gmail but never applied to threads, and (2) "Mark done" (and other state changes) don't stick on refresh. See `docs/CURRENT_STATE.md` → "Known-broken" for the root causes.

## Why this direction

The current full-dashboard inbox direction has a major adoption problem: users already live in Gmail. Asking them to switch email clients increases friction, trust concerns, and onboarding time.

A Gmail-native approach reduces switching cost:

- Users keep their current Gmail workflow.
- FlowDesk creates value directly inside the inbox they already use.
- The website is a secondary support surface — not where users must live every day — but it is still a real, polished product that has to work correctly and look good.
- The agent can still use the same backend classification, drafting, sync, and profile logic already built.

## Strategic positioning

Old positioning:

> AI email client / AI inbox dashboard.

New positioning:

> AI chief of staff for Gmail.

Alternative phrasing:

> FlowDesk is an AI email operator that works inside your existing Gmail.

Primary user-facing pitch:

> FlowDesk labels, prioritizes, drafts, and tracks follow-ups inside Gmail so your inbox is already organized when you open it.

## Product surfaces

### 1. Gmail-native backend actions

This is the core product.

FlowDesk should directly modify the user's Gmail using the Gmail API:

- Create and manage FlowDesk labels.
- Apply labels to messages and threads.
- Create Gmail drafts for suggested replies.
- Mark safe low-value emails as read.
- Archive or categorize safe emails when permission allows.
- Track sent threads that are waiting for a reply.
- Detect follow-ups and apply follow-up labels.
- Keep an internal audit log of every action.

Gmail label structure (flat, top-level labels — no `FlowDesk/` namespace prefix):

```text
Needs Reply
Needs Action
Waiting On
Follow Up
Read Later
Important
Handled
Autodrafted
Low Priority
```

Keep labels user-friendly. Avoid exposing internal states like `triage_pending`, `classification_v2`, or `work_item_status`. (`Handle First` was removed — it was never producible as a stable per-thread label.)

### 2. FlowDesk dashboard

The dashboard stays, but its job changes.

It should become the agent control room:

- Connect Gmail account.
- Configure label rules.
- Set automation level.
- Review approval queue.
- View daily inbox brief.
- See agent activity and audit logs.
- Train writing style.
- Set personal/business context.
- Manage VIPs, blocked senders, and categories.
- Review conversations in a power-user view.

The dashboard should not require users to abandon Gmail. It should make the Gmail-native agent more trustworthy, configurable, and transparent.

### 3. Gmail add-on

A Google Workspace / Gmail add-on should be considered after the backend agent is working well.

Best uses:

- Show FlowDesk summary for the currently opened email.
- Show why the email was labeled a certain way.
- Show suggested action.
- Allow quick actions: mark handled, follow up later, draft reply, teach FlowDesk.
- Insert reply templates or AI-generated content into compose.
- Provide a more official Google Workspace Marketplace distribution path.

Tradeoff:

- More trustworthy and cross-platform than a Chrome-only extension.
- More limited UI flexibility than a browser extension.

### 4. Browser extension

A browser extension is not needed for core inbox access if the backend already has Gmail API OAuth access.

The extension is useful for UI and workflow enhancement, not for better raw email data access.

Best uses:

- Add a persistent FlowDesk side panel inside Gmail.
- Add inline AI chips next to Gmail messages.
- Add hover summaries on Gmail thread rows.
- Add quick action buttons directly inside Gmail.
- Add command palette: “Ask FlowDesk about this thread.”
- Detect which Gmail thread the user is currently viewing and show relevant FlowDesk context.
- Make FlowDesk feel embedded in Gmail rather than separate from Gmail.

Tradeoff:

- Most magical UX.
- More fragile because Gmail DOM changes can break injected UI.
- More trust friction because users may hesitate to install extensions with Gmail page access.
- Chrome-first; weaker story for Safari, Firefox, mobile, and locked-down company environments.

## Browser extension vs Gmail API

The Gmail API is better for backend actions:

- Reading messages.
- Syncing mailbox changes.
- Creating/applying labels.
- Creating drafts.
- Updating message state.
- Running server-side automation.

The browser extension is better for frontend UX:

- Displaying FlowDesk UI inside Gmail.
- Injecting buttons/chips/side panels.
- Understanding the user's current Gmail screen context.
- Reducing the need to switch tabs to the FlowDesk dashboard.

Therefore:

- Do not build the extension to get inbox access.
- Build the extension when the product needs a magical in-Gmail interface.
- The API remains the source of truth for actions.
- The extension should call the FlowDesk backend, not become the core email processing engine.

## Competitor landscape

### Direct AI email assistants

- **Fyxer**: AI email assistant focused on inbox triage, drafts, and meeting notes. Strong reference for “works without switching apps.”
- **Inbox Zero**: Open-source AI email assistant for Gmail/Outlook. Very relevant competitor and inspiration source. Features include AI rules, pre-drafted replies, reply tracking, bulk unsubscribe, cold email blocking, analytics, and Slack/Telegram interaction.
- **Shortwave**: AI-native Gmail client. Strong product inspiration, but it is more of a Gmail client replacement.
- **Superhuman**: Premium speed-focused email client with AI features. Strong brand and workflow benchmark, but switching-cost problem is still present.
- **SaneBox**: Long-running email triage/categorization product. Good reference for “quietly organize existing inbox.”
- **Spark**: Email client with AI writing and collaboration features.
- **Missive**: Team/shared inbox, strong for collaborative workflows.
- **Lindy / Perplexity Email Assistant / broader agent products**: More general AI assistant approach that includes email, calendar, and cross-app workflows.
- **Google Gemini in Gmail**: Built-in threat/competitor. FlowDesk must win by being more customizable, more agentic, and more workflow-specific than generic Gemini features.

### Open-source projects to study

- **elie222/inbox-zero**: Most important open-source reference. Study its AI rules, reply-zero tracking, analytics, sender categories, bulk actions, and integrations.
- **Mail-0/Zero**: Open-source AI email client with self-hosting angle and external provider integrations.
- **paabloLC/gmail-ai-draft**: Simple Gmail draft-generation project. Useful inspiration for drafting directly into Gmail.
- **muqadasejaz/n8n-Smart-Email-Assistant**: n8n automation for Gmail prioritization, labeling, and draft/send workflows.
- **ericrosenberg1/ai-email-assistant**: Linux-based Gmail drafting assistant using sent-message style indexing.
- **auroracapital/ai-gmail-assistant**: Gmail organization, categorization, labels, star/priority, draft responses.
- **darinkishore/Inbox-MCP**: MCP server for email integration via Nylas; useful if FlowDesk later supports external AI clients or user-owned agents.
- **ankitvgupta/exo**: Open-source AI-native desktop email client. Useful for AI-first email UX patterns.
- **n8n Gmail/OpenAI templates**: Good source for lightweight workflows like auto-labeling and draft generation.

## What FlowDesk should learn from competitors

### From Inbox Zero

- Natural-language AI rules are powerful.
- Reply tracking and waiting-on-me/waiting-on-them states are valuable.
- Bulk unsubscribe/archive is a practical value prop.
- Open-source users care about transparency and customization.

### From Fyxer

- “Works where you already work” is a strong positioning angle.
- Drafting and triage should be visible in the user's existing inbox.
- Meeting notes/calendar adjacent workflows can increase value later.

### From SaneBox

- Quiet background organization is useful even without flashy UI.
- Users will pay for invisible inbox cleanup if it is reliable.

### From Superhuman / Shortwave

- Fast workflows and keyboard-driven UX matter for power users.
- But replacing the email client creates adoption friction.

### From Gmail/Gemini

- Generic AI features will become table stakes.
- FlowDesk needs to be more personalized, more rule-driven, and more operational than “summarize/draft this email.”

## Differentiation thesis

FlowDesk should not try to beat Gmail at being Gmail.

FlowDesk should win by being the controllable AI operator layer on top of Gmail:

- Works inside the existing inbox.
- Learns user-specific rules.
- Takes real actions, not just suggestions.
- Produces drafts in the user's Gmail.
- Tracks waiting-on/follow-up states.
- Gives a transparent audit trail.
- Has automation levels so users can gradually increase trust.
- Adapts to each individual's use case (see Audience below).

## Audience: B2C (individuals)

FlowDesk is a B2C product: we sell to individual people, not organizations.
There is no "business account" as a distinct mode. Every user gets the same
control room and can customize it to their own use case.

Implications:

- One universal experience. Navigation, the home control room, and copy are the
  same for everyone — no `personal` vs `business` account branching in the UI.
- Formerly business-only capabilities (Leads, Risk Radar, Reports, sales-signal
  classification, CRM framing) are now a single **opt-in "Sales & CRM mode"**
  capability any user can enable in Settings → Features, default off, rather than
  gated behind an account type.
- The old `Tenant.accountType` identity has been dropped. Phase 1 unified
  navigation and the home control room; Phase 2 moved every read (AI prompts,
  sync layer, page gates, signup/auth) onto `Tenant.salesCrmEnabled` and flipped
  the default to the clean baseline. Finer-grained capability toggles can split
  out later.

## Automation levels

Use explicit trust levels so users can adopt gradually.

```text
Level 0: Read-only insights
Level 1: Suggest labels and replies in dashboard only
Level 2: Apply labels automatically in Gmail
Level 3: Create Gmail drafts automatically
Level 4: Mark low-risk emails read / archive safe categories
Level 5: Auto-send only tightly approved categories
```

Default should be Level 2 or Level 3, depending on the user type.

Never start users at auto-send.

## Roadmap

The Gmail-native foundations (labels, drafts, waiting-on/follow-up, the control-room dashboard) are **built** — see `docs/CURRENT_STATE.md` for exactly what ships today. The problem is no longer "can FlowDesk touch Gmail?" It is "does the core loop work reliably and does the product feel trustworthy and polished?" The roadmap is therefore reordered around **correctness first, then polish, then capability**. The actionable, checkbox-level backlog lives in `docs/TODO.md`; this section is the strategic framing.

### Phase 1 — Trustworthy core loop (current focus)

Goal: the loop *classify → act in Gmail → reflect state truthfully in the UI* is reliable. Nothing new ships until the basics are rock-solid.

- **Gmail actions actually happen.** Close the gap where labels are created but never applied to threads. Label projection must run as a reliable consequence of sync/classification (inline, with the cron as backup) rather than silently depending on a background cron that may not be scheduled. Add health visibility so a stalled queue is impossible to miss.
- **State is the single source of truth.** An explicit user decision (Mark done / read / archive / waiting-on) persists and is never overridden by re-classification or a re-created draft. Fix the priority-resolution ordering in `lib/agent/command-center.ts` so the saved user state wins, and have the dashboard trust persisted state instead of recomputing it every render.
- **Verify end-to-end in the real app**, not just unit tests: mark done → refresh → still gone; label a thread → see it in Gmail.

Success metric: a user can trust that what FlowDesk says it did, it actually did — in Gmail and in the app.

### Phase 2 — Web-app polish (secondary surface, high bar)

Goal: the companion web app looks and feels like a real product, taking layout cues from Inbox Zero and the other references.

- Split the oversized settings page into focused, navigable sections.
- Rebuild the dashboard/inbox shell and navigation so the secondary surface is clean and coherent.

Success metric: the web app reads as polished and intentional, not as a pile of stacked panels.

### Phase 3 — Capability parity from the reference repos

Goal: close the capability gap with the projects we studied (`docs/reference-research/`, `docs/flowdesk-vs-reference-gap-analysis.md`).

- Port marquee pieces — bulk unsubscribe/cleanup depth, smart categories, reply-tracking UX, richer rule authoring — copying code where it makes sense.

Success metric: FlowDesk matches or beats the reference inboxes on the features users notice.

### Explicitly de-scoped for now

Moved out of near-term focus so they don't distract from the phases above: Outlook failure-cause recording and writeback parity, CC/BCC send, inline-image backfill, Gmail add-on / browser extension, and other small correctness items. Tracked under "Later / de-scoped" in `docs/TODO.md`.

## Technical principles

- Gmail API is the source of truth for mailbox actions.
- FlowDesk database stores classifications, work items, preferences, audit logs, and memory.
- Gmail labels are the user-visible projection of FlowDesk state.
- Do not rely on browser extension DOM scraping for core sync or processing.
- Extension/add-on should call FlowDesk backend and show contextual UI.
- Every automated action should have an audit event.
- Every destructive action needs conservative defaults and undo/reversal strategy.
- Deduplicate drafts and actions aggressively.
- Keep user-facing labels simple.

## Suggested repo tasks

### Backend

- Add `gmail_label_mappings` table for configurable labels.
- Add label bootstrap function on account connect.
- Add idempotent `ensureFlowDeskLabels(userId)` job.
- Extend the shipped label projection service into `applyFlowDeskStateToGmail(conversationId)`.
- Continue using `AuditLog` for Gmail mutations unless label/action audit volume requires a dedicated table.
- Extend the shipped retry-safe `GmailWritebackQueue` wrapper to cover all Gmail mutations.
- Add draft deduplication logic.

### Frontend dashboard

- Rename dashboard language from “inbox replacement” to “agent control room.”
- Add Gmail-native settings page.
- Add automation level selector.
- Add label configuration UI.
- Add audit log UI.
- Add approval queue UI.

### Agent/AI

- Improve classification schema around Gmail-native labels.
- Add confidence thresholds per action.
- Add low-risk action policy.
- Add user-edit feedback loop for labels.
- Add draft quality checks.
- Add “do not draft” categories.

### Future extension/add-on

- Build minimal Gmail contextual panel.
- Show current thread summary.
- Show label reason.
- Add buttons: Mark handled, Follow up later, Draft reply, Teach FlowDesk.
- Keep all actual state mutations server-side.

## Open questions

- Resolved: targeting individuals (B2C). See "Audience: B2C" above. Team/shared
  inboxes are out of scope.
- Resolved (2026-07-07): Gmail-first. Outlook parity is de-scoped until the Gmail
  core loop is trustworthy and the web app is polished (Phases 1–2).
- Resolved (2026-07-07): the Chrome extension / Gmail add-on waits until after the
  Gmail-native core loop is validated and reliable.
- What automation level should be default for first-time users?
- How do we present permissions in a way users trust?
- What is the minimum audit log needed for users to feel safe?

## Sources and references

- Gmail API labels: https://developers.google.com/workspace/gmail/api/guides/labels
- Gmail API modify messages: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify
- Gmail API push notifications: https://developers.google.com/workspace/gmail/api/guides/push
- Gmail API history list: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Google Workspace add-ons for Gmail: https://developers.google.com/workspace/add-ons/gmail
- Google Workspace Marketplace review: https://developers.google.com/workspace/marketplace/about-app-review
- Inbox Zero open source repo: https://github.com/elie222/inbox-zero
- Zero open source repo: https://github.com/mail-0/zero
- GmailDraft open source repo: https://github.com/paabloLC/gmail-ai-draft
- n8n Smart Email Assistant: https://github.com/muqadasejaz/n8n-Smart-Email-Assistant
- Inbox MCP: https://github.com/darinkishore/Inbox-MCP
- Exo: https://github.com/ankitvgupta/exo
