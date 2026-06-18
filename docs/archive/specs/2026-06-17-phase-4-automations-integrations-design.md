# Phase 4: Automations And Integrations — Design Spec

Date: 2026-06-17  
Phase: 4 (v4.0.0)  
Goal: Let FlowDesk safely perform multi-step work across the user's tools.

## Scope

Eight features from `docs/TODO.md`, excluding #39 (Auto-personalized outreach — explicitly "later"):

| # | Feature | Approach |
|---|---|---|
| 2 | Category-scoped autopilot policy builder | Full — UI upgrade, no new model |
| 14 | Full scheduling back-and-forth | Full — `SchedulingSession` model + detection + draft proposals |
| 26 | Outcome-based automation | First slice — `AutomationRun` trace model + approval gates + rollback |
| 27 | Train My Agent with plain English | Full — `AgentRule` model + NL compiler + settings UI |
| 31 | Multi-step email workflows | First slice — `WorkflowTemplate` + `WorkflowRun` + basic 2-3 step sequences |
| 35 | Context from connected apps | First slice — Google Drive credential + settings UI |
| 37 | Auto-generated snippets and playbooks | Full — `Snippet` model + miner cron + composer picker |
| 41 | One-click Clean My Inbox | Full — `/clean-inbox` page with bulk ops + undo |

---

## Feature Designs

### 1. Category-Scoped Autopilot Policy Builder (#2)

**What exists:** `AutopilotSetting` with a global `confidenceThreshold` and `categoryThresholdsJson` (per-intent number overrides). The UI exposes FAQ/Lead/Complaint intent thresholds.

**Gap:** No per-attention-category *policy* (auto-send vs. require approval vs. never). Users can't say "auto-archive newsletters but always ask before sending a reply to `needs_reply`."

**Design:** Extend `categoryThresholdsJson` to store a richer structure per attention category:

```json
{
  "needs_reply":  { "action": "require_approval", "threshold": 0.90 },
  "fyi_done":     { "action": "auto_send",        "threshold": 0.80 },
  "quiet":        { "action": "never" },
  "read_later":   { "action": "auto_send",        "threshold": 0.75 }
}
```

**UI changes (`AutopilotSettingsForm`):**
- Replace per-intent number list with a per-attention-category table.
- Each row: category label, action selector (Auto-send / Require approval / Never), optional threshold.
- Auto-send rows show a threshold number input; Never rows hide it.
- API: existing `PATCH /api/autopilot-settings` already stores `categoryThresholds` — extend the payload shape.

**No schema migration needed.** `categoryThresholdsJson` is already `Json?`.

---

### 2. Full Scheduling Back-And-Forth (#14)

**What exists:** `CalendarHold`, `GoogleCalendarCredential`, `listEvents` in calendar lib.

**Gap:** No detection of "can we meet?" requests, no time-slot proposal in drafts, no confirmation → event booking flow.

**New model: `SchedulingSession`**

```prisma
model SchedulingSession {
  id             String   @id @default(cuid())
  tenantId       String
  conversationId String   @unique
  status         String   @default("detecting")  // detecting | proposing | confirmed | booked | cancelled
  proposedTimesJson Json? // array of { start, end, label }
  confirmedTime  String?  // ISO datetime chosen by counterpart
  calendarEmail  String?
  eventId        String?  // Google Calendar event ID after booking
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  tenant         Tenant   @relation(...)
  conversation   Conversation @relation(...)
}
```

**Pipeline:**
1. **Detection (`lib/agent/scheduling.ts`):** Scan inbound email body for scheduling signals (regex + keyword: "can we meet", "schedule a call", "find a time", "available for a chat"). Runs in `syncConversationWorkItems`.
2. **Proposal generation:** When detected, call OpenAI to extract time preferences from the email + check `listEvents` for the next 5 business days → pick 3 non-conflicting 30-min slots → store in `SchedulingSession.proposedTimesJson`.
3. **Draft injection:** Proposed times are injected into the AI draft as a human-readable "Here are 3 times that work for me: …" block.
4. **Confirmation detection:** On next inbound message, check if it contains a time confirmation ("I'll take the 2pm slot", "Tuesday at 3 works"). If matched, create a Google Calendar event via `createEvent`, update `SchedulingSession.status = 'booked'`, update `ConversationState` to `waiting_on`.
5. **Conversation page:** Show `SchedulingPanel` on conversation sidebar when a `SchedulingSession` exists — status, proposed times, confirmed slot, event link.

**API routes:**
- `POST /api/conversations/[id]/scheduling` — trigger scheduling session manually.
- `PATCH /api/conversations/[id]/scheduling` — update confirmed time or cancel.

---

### 3. Outcome-Based Automation (#26)

**Goal:** Users define *what they want to happen* ("When I get a billing dispute, create a task, draft a reply using KB, and flag for my review"). FlowDesk traces each step, gates on approval, and supports rollback.

**New model: `AutomationRun`**

```prisma
model AutomationRun {
  id               String   @id @default(cuid())
  tenantId         String
  conversationId   String
  trigger          String   // e.g. "billing_dispute_detected"
  stepsJson        Json     // array of { step, status, output, rollbackData }
  status           String   @default("pending") // pending | running | awaiting_approval | completed | rolled_back | failed
  approvalRequired Boolean  @default(true)
  approvalRequestId String?
  rolledBackAt     DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  tenant           Tenant   @relation(...)
  conversation     Conversation @relation(...)
}
```

**Step types (stored in `stepsJson`):**
- `create_task` — creates an `InboxTask`; rollback deletes it.
- `create_draft` — creates/updates `Draft`; rollback resets draft to `none`.
- `send_draft` — requires approval gate; rollback not possible (logs warning).
- `update_attention` — updates `ConversationState.attentionCategory`; rollback reverts to previous.
- `archive` — archives conversation; rollback unarchives.

**Execution (`lib/agent/automation-runner.ts`):**
- Triggered after classification when `attentionCategory` matches a user-defined trigger condition.
- Runs steps sequentially, recording output and rollback data for each.
- If `approvalRequired`, creates `ApprovalRequest` before `send_draft` steps.
- Each step is idempotent (uses deterministicKey pattern).

**Rollback:** `POST /api/automation-runs/[id]/rollback` reverses each completed step in reverse order using stored rollback data, logs to `AuditLog`.

**UI:**
- `AutomationRunHistory` panel on conversation page — shows triggered automations, steps, status.
- Rollback button for completed runs (within 24h).

**No user-facing automation builder in this slice.** Trigger conditions are seeded as system defaults (billing dispute, urgent VIP, scheduling request). User-defined triggers come in a later slice.

---

### 4. Train My Agent With Plain English (#27)

**What exists:** `SenderRule` for email/domain → attention category (suggested from corrections, apply/dismiss). Users can't manually create rules or express anything beyond attention routing.

**Gap:** Users can't say "mark everything from Amazon as read_later" without making 3+ manual corrections. No plain-English interface. No conflict detection.

**New model: `AgentRule`**

```prisma
model AgentRule {
  id              String   @id @default(cuid())
  tenantId        String
  plainText       String   // user's original plain-English input
  ruleType        String   // "attention" | "label" | "archive" | "snippet_suggest"
  conditionsJson  Json     // e.g. { "matchType": "domain", "matchValue": "amazon.com" }
  actionJson      Json     // e.g. { "targetAttention": "read_later" }
  status          String   @default("active") // active | paused | conflict
  source          String   @default("plain_english") // plain_english | manual
  previewCount    Int?     // how many recent emails match this rule
  conflictsWith   String?  // id of conflicting AgentRule
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  tenant          Tenant   @relation(...)
}
```

**Compiler (`lib/agent/rule-compiler.ts`):**
- Input: plain English string (e.g. "Move all newsletters to read later").
- Output: structured `{ ruleType, conditionsJson, actionJson }`.
- Uses OpenAI with a structured output prompt; falls back to regex patterns for common cases.
- Returns a confidence score; low-confidence rules are flagged for review.

**Preview (`POST /api/agent-rules/preview`):**
- Compiles the rule, runs a dry-run query against recent conversations (last 90 days).
- Returns: affected count, up to 5 example conversation subjects, detected conflicts with active rules.

**Conflict detection:**
- A new rule conflicts with an existing `SenderRule` or `AgentRule` that targets the same sender/domain.
- Explicit user rules always win; conflicts are surfaced in the preview, not blocked.

**Settings UI (`TrainAgentPanel`):**
- Text input: "Describe a rule in plain English…"
- "Preview" button → shows affected emails + conflicts.
- "Add rule" → saves active rule.
- Active rules list: edit, pause, delete.
- Migrate existing `SenderRule` items into the new UI as `AgentRule` rows (read from both tables; writes go to `AgentRule`; existing `SenderRule` PATCH still works).

**Rule application:** `AgentRule` conditions evaluated alongside `SenderRule` in `syncConversationWorkItems`. `AgentRule` takes precedence over `SenderRule` for the same match target.

---

### 5. Multi-Step Email Workflows (#31)

**Goal:** Users define sequences of steps that run after a trigger — e.g. "when a lead goes quiet for 3 days, send follow-up 1, wait 3 days, send follow-up 2, then close."

**First-slice scope:** Define templates, store workflow state, execute 2-3 step sequences. No drag-and-drop workflow builder (comes later).

**New models:**

```prisma
model WorkflowTemplate {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  trigger     String   // "lead_quiet_3d" | "scheduling_unconfirmed_2d" | ...
  stepsJson   Json     // array of WorkflowStep
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tenant      Tenant   @relation(...)
  runs        WorkflowRun[]
}

model WorkflowRun {
  id                 String   @id @default(cuid())
  tenantId           String
  workflowTemplateId String
  conversationId     String
  currentStep        Int      @default(0)
  status             String   @default("running") // running | paused | completed | cancelled
  stateJson          Json?    // per-step outputs and metadata
  nextRunAt          DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  tenant             Tenant   @relation(...)
  template           WorkflowTemplate @relation(...)
  conversation       Conversation @relation(...)
}
```

**WorkflowStep shape (in `stepsJson`):**
```json
{ "type": "send_draft", "waitDaysAfterPrevious": 0, "requireApproval": true, "draftHint": "..." }
{ "type": "wait", "days": 3 }
{ "type": "close_conversation" }
```

**Execution (`lib/agent/workflow-runner.ts`):**
- Cron job checks `WorkflowRun` records where `nextRunAt <= now`.
- Advances one step, executes it (calls draft/archive/task APIs internally).
- Sets `nextRunAt` based on next wait step or marks `completed`.

**Seeded templates (3 defaults per tenant):**
1. Lead quiet follow-up (trigger: `lead_quiet_3d`).
2. Scheduling unconfirmed nudge (trigger: `scheduling_unconfirmed_2d`).
3. VIP follow-up if no reply (trigger: `vip_no_reply_2d`).

**Settings UI (`WorkflowsPanel`):**
- Lists default and custom workflow templates.
- Enable/disable toggle per template.
- View active runs with step progress.

---

### 6. Context From Connected Apps (#35)

**Goal:** "Choose integrations by workflow, not logo count." Start with Google Drive — the most natural complement to Gmail.

**First-slice scope:** Connect Google Drive, pull document context when drafting replies that reference a file, show in settings.

**New model: `GoogleDriveCredential`**

```prisma
model GoogleDriveCredential {
  id                    String   @id @default(cuid())
  tenantId              String   @unique
  email                 String
  accessTokenEncrypted  String
  refreshTokenEncrypted String
  tokenExpiry           DateTime?
  createdAt             DateTime @default(now())
  tenant                Tenant   @relation(...)
}
```

**OAuth flow:**
- `GET /api/integrations/google-drive/connect` → redirect to Google OAuth with Drive scope.
- `GET /api/integrations/google-drive/callback` → exchange code, store credential.
- `DELETE /api/integrations/google-drive/disconnect` → delete credential (cascade pattern).

**Context pull (`lib/integrations/google-drive.ts`):**
- `searchDriveForContext(query: string)` → calls Drive Files API with the email subject + sender as query, returns top 3 file titles + snippets.
- Called lazily during draft generation when Drive credential exists.
- Results appended to draft system prompt as "Relevant documents from your Drive: …".

**Settings UI:**
- New "Connected Apps" section in `/settings`.
- Google Drive: connect/disconnect button, shows connected email.
- Architecture note: `ConnectedApp` enum or registry pattern for future integrations (Notion, Slack).

---

### 7. Auto-Generated Snippets And Playbooks (#37)

**Goal:** FlowDesk mines repeated phrases from sent emails, suggests them as reusable snippets, and lets users approve/reject. Snippets appear in the reply composer.

**New model: `Snippet`**

```prisma
model Snippet {
  id          String   @id @default(cuid())
  tenantId    String
  title       String
  content     String
  useCount    Int      @default(0)
  status      String   @default("suggested") // suggested | active | dismissed
  source      String   @default("mined")     // mined | manual
  minedFromJson Json?  // sample message IDs this was derived from
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tenant      Tenant   @relation(...)
}
```

**Miner (`lib/agent/snippet-miner.ts`):**
- Queries last 60 days of outbound messages for the tenant.
- Extracts candidate phrases: greetings, sign-offs, common mid-body patterns (regex + OpenAI clustering).
- Deduplicates and scores by frequency.
- Creates `Snippet` records with `status: "suggested"` for patterns appearing 3+ times.
- Runs weekly via `GET /api/cron/snippet-mine`.

**Composer integration:**
- "Snippets" button in reply composer toolbar (below text area).
- Dropdown shows active snippets, filter by title.
- Clicking a snippet inserts its content at cursor position.

**Settings UI (`SnippetsPanel`):**
- Suggested snippets: approve / dismiss.
- Active snippets: edit title/content, delete.
- "Add manual snippet" form.

**API routes:**
- `GET /api/snippets` — list tenant snippets.
- `POST /api/snippets` — create manual snippet.
- `PATCH /api/snippets/[id]` — approve/dismiss/edit.
- `DELETE /api/snippets/[id]` — delete.

---

### 8. One-Click Clean My Inbox (#41)

**Goal:** Give users a guided bulk-cleanup experience: see what can be archived/unsubscribed with one click, preview before acting, and undo if needed.

**No new models needed.** Builds on existing archive writeback, unsubscribe detection, and `ConversationState`.

**New page: `/clean-inbox`**

**Sections (computed server-side):**
1. **Newsletters & marketing** — conversations where `emailType` is `newsletter` or `marketing`, grouped by sender domain. Shows "Unsubscribe & Archive" (uses existing unsubscribe route) or "Archive all".
2. **Noise & quiet email** — `attentionCategory: quiet` conversations. "Archive all from this sender".
3. **Already done** — `fyi_done` conversations still in inbox. "Archive all".
4. **Snoozed (expired)** — snooze reminders that have resurfaced. "Dismiss all".

**Each section shows:**
- Count of emails.
- Sample sender names / domains.
- Estimated inbox space freed (rough count).
- "Archive all" / "Unsubscribe & archive all" action button.

**Bulk actions:**
- `POST /api/clean-inbox/archive-batch` — accepts array of `conversationIds`, archives each via existing `archiveGmailThread`.
- `POST /api/clean-inbox/unsubscribe-batch` — accepts array of `conversationIds`, fires existing unsubscribe route for each.
- Returns a `batchToken` for undo.

**Undo:** `POST /api/clean-inbox/undo/[batchToken]` — stores batch tokens in a short-lived (1h) in-memory or Redis-free approach: store the batch record in `AuditLog` as `clean_inbox_batch` with payloadJson containing conversationIds. Undo fetches the batch, calls `unarchiveGmailThread` (remove Trash/Archive label, restore INBOX) for each.

**UI:** 
- Clean progress bar showing sections completed.
- "Start fresh" button at top navigates here from inbox command center.
- AppRail nav icon (broom/sparkle).

---

## Data Model Summary

New Prisma models:

| Model | Feature | Key fields |
|---|---|---|
| `SchedulingSession` | #14 | `conversationId`, `status`, `proposedTimesJson`, `confirmedTime`, `eventId` |
| `AutomationRun` | #26 | `trigger`, `stepsJson`, `status`, `approvalRequired`, `rolledBackAt` |
| `AgentRule` | #27 | `plainText`, `ruleType`, `conditionsJson`, `actionJson`, `status`, `previewCount` |
| `WorkflowTemplate` | #31 | `name`, `trigger`, `stepsJson`, `enabled` |
| `WorkflowRun` | #31 | `workflowTemplateId`, `conversationId`, `currentStep`, `status`, `nextRunAt` |
| `GoogleDriveCredential` | #35 | `tenantId`, `email`, encrypted tokens |
| `Snippet` | #37 | `title`, `content`, `useCount`, `status`, `source` |

No model changes for #2 (autopilot policy) or #41 (clean inbox).

## New API Routes

| Route | Feature |
|---|---|
| `PATCH /api/autopilot-settings` (extend) | #2 |
| `POST /api/conversations/[id]/scheduling` | #14 |
| `PATCH /api/conversations/[id]/scheduling` | #14 |
| `POST /api/automation-runs/[id]/rollback` | #26 |
| `POST /api/agent-rules/preview` | #27 |
| `GET/POST /api/agent-rules` | #27 |
| `PATCH/DELETE /api/agent-rules/[id]` | #27 |
| `GET/POST /api/workflow-templates` | #31 |
| `PATCH /api/workflow-templates/[id]` | #31 |
| `GET /api/integrations/google-drive/connect` | #35 |
| `GET /api/integrations/google-drive/callback` | #35 |
| `DELETE /api/integrations/google-drive/disconnect` | #35 |
| `GET/POST /api/snippets` | #37 |
| `PATCH/DELETE /api/snippets/[id]` | #37 |
| `GET /api/cron/snippet-mine` | #37 |
| `GET /api/cron/workflow-runner` | #31 |
| `POST /api/clean-inbox/archive-batch` | #41 |
| `POST /api/clean-inbox/unsubscribe-batch` | #41 |
| `POST /api/clean-inbox/undo/[batchToken]` | #41 |

## New Pages / UI

| Page/Component | Feature |
|---|---|
| `/clean-inbox` page | #41 |
| `SchedulingPanel` (conversation sidebar) | #14 |
| `AutomationRunHistory` (conversation sidebar) | #26 |
| `TrainAgentPanel` (settings) | #27 |
| `WorkflowsPanel` (settings) | #31 |
| `SnippetsPanel` (settings) | #37 |
| Snippet picker in reply composer | #37 |
| "Connected Apps" section in settings | #35 |
| Autopilot policy table in `AutopilotSettingsForm` | #2 |
| Clean Inbox icon in AppRail | #41 |

## Trust And Safety

- All `AutomationRun` steps involving sends require `ApprovalRequest`.
- `AgentRule` actions limited to attention routing, archiving, and snippet suggestions — no auto-send.
- `WorkflowRun` send steps respect existing `AutopilotSetting` gates.
- Bulk clean-inbox actions are reversible (undo within 1h) and logged to `AuditLog`.
- `SchedulingSession` never books without a confirmation confirmation step.
- Google Drive scope: `drive.readonly` — read-only context only, no writes.

## Verification

```bash
npm test
npx tsc --noEmit
npm run build
```

Focused test files to add:
- `tests/agent-rule-compiler.test.ts`
- `tests/scheduling-detector.test.ts`
- `tests/snippet-miner.test.ts`
- `tests/workflow-runner.test.ts`
- `tests/clean-inbox-batch.test.ts`
- `tests/automation-runner.test.ts`
