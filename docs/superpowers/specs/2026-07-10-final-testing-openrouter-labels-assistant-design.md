# Final Testing OpenRouter, Labels, Mail, And Assistant Design Spec

Date: 2026-07-10
Status: Approved for implementation planning. No product code is changed by this document.

## Intent

This phase prepares FlowDesk Inbox for real-user testing by finishing four high-impact areas:

- Move AI calls from a single OpenAI key to OpenRouter with one child API key per FlowDesk user.
- Track AI usage per user, feature, model, and provider generation instead of only tenant-level estimated usage.
- Make Mail and thread detail keep the same sticky, label-oriented top navigation.
- Collapse "tags", workflow statuses, attention categories, content types, and business-only labels into one user-facing label model.
- Make Assistant Rules, Test, History, and Settings feel like real control-room pages using Inbox Zero as the primary UX reference.

The product goal is not to become Inbox Zero or a full email client. Gmail remains the user's daily workspace. FlowDesk is the setup, supervision, training, and correction surface that writes native Gmail labels/drafts and learns from user corrections.

## Research Summary

### OpenRouter

OpenRouter supports OpenAI-compatible runtime calls at `https://openrouter.ai/api/v1`. It also supports Management API keys for programmatic key management under `/api/v1/keys`. Management keys are admin-only and cannot call completion endpoints.

Important OpenRouter facts for this phase:

- Runtime calls authenticate with `Authorization: Bearer <OPENROUTER_API_KEY>`.
- OpenAI-compatible clients can set `baseURL: "https://openrouter.ai/api/v1"`.
- Requests can include `user`, described by OpenRouter as a stable end-user identifier.
- Responses include usage tokens and may include `usage.cost`.
- The returned generation `id` can be queried through the generation endpoint for usage/cost metadata.
- Management keys can create, list, update, disable, and delete runtime API keys.
- Child keys can have a credit limit and a reset period.

Decision: provision one OpenRouter runtime child key per FlowDesk user, not per tenant. This gives OpenRouter-level attribution, revocation, and limits per tester while FlowDesk keeps its own internal usage ledger.

### Reference Repos

Cloned into `/Users/sakshamgoel/Documents/ProjectsInternships/reference repos`:

- `mail-0-zero`
- `cloudflare-agentic-inbox`
- `paabloLC-gmail-ai-draft`
- `auroracapital-ai-gmail-assistant`

Useful patterns:

- `mail-0/zero`: labels are visible pills, label settings are concrete, and thread/list layouts preserve mail context.
- `cloudflare/agentic-inbox`: agent tools are explicit, typed business operations and draft/send actions are confirmation-friendly.
- `paabloLC/gmail-ai-draft`: simple AI settings and Gmail-native drafts are easier for users to understand than broad automation surfaces.
- `auroracapital/ai-gmail-assistant`: OpenRouter can be used through the OpenAI SDK base URL, and compact action/respond/FYI labels are easier to grasp than large hidden taxonomies.

Implementation may borrow structural ideas. Do not paste large code blocks. If any copied implementation detail is used, preserve license obligations and attribution.

## Current FlowDesk State

### AI Calls

Current AI calls are spread across:

- `lib/ai/openai.ts`
- `lib/ai/provider.ts`
- `lib/agent/classify.ts`
- `lib/agent/rule-compiler.ts`
- `lib/agent/inbox-chat.ts`
- `lib/agent/person-memory.ts`
- `app/api/chat/route.ts`
- `app/api/conversations/[id]/draft/suggest/route.ts`

Most of these read `OPENAI_API_KEY` and `OPENAI_MODEL` directly. `AiUsageEvent` records tenant, feature, model, estimated tokens, estimated cost, and status, but not user, provider, actual returned cost, or generation ID.

### Mail And Thread Detail

`/mail` has a desktop top tab bar via `MailTopTabs`, but it still uses legacy tab values from `lib/mail-top-tabs.ts`:

- `Important`
- `Needs Reply`
- `Waiting On`
- `Read Later`
- `Other`
- `Calendar`

The thread detail page at `app/conversations/[id]/page.tsx` uses the newer rail and split panel layout, but it does not render the Mail top tabs. Opening a message therefore drops the label/tab context that exists on the Mail page.

### Labels And Tags

There are several overlapping concepts:

- Canonical Gmail labels in `lib/gmail-labels.ts`: `Needs Reply`, `Needs Action`, `Waiting On`, `Read Later`, `Handled`, `Autodrafted`, `Newsletter`, `Marketing`, `Notification`, `Calendar`.
- Workflow status select: four settable workflow states.
- Attention correction endpoint: internal attention categories like `needs_action`, `review_soon`, `quiet`, `fyi_done`.
- Content type classifier: `newsletter`, `marketing`, `notification`, `calendar`, `fyi`.
- Business-only `Conversation.label` with values `Lead`, `Reschedule`, `Pricing`, `Complaint`.
- Hover action in `MailInboxRow` titled "Change tag", wired only to workflow-status updates.

This is why users can only change a row to four statuses instead of all visible Gmail labels. Product language should now use "label" only. "Tag" should disappear from the UI unless it is a code-only compatibility term.

### Assistant

Assistant pages exist and use real backend pieces:

- `app/assistant/rules/page.tsx`
- `app/assistant/test-rules/page.tsx`
- `app/assistant/history/page.tsx`
- `app/assistant/settings/page.tsx`
- `app/settings/SenderRulesPanel.tsx`
- `app/settings/TrainAgentPanel.tsx`
- `app/api/agent-rules/dry-run/route.ts`

But the pages are thin: Test Rules asks for a raw rule ID, History shows raw audit action strings, Settings is mostly an embedded training panel, and the overall page layout does not match the richer Inbox Zero pattern in the provided screenshots.

## Product Decisions

### 1. Per-User OpenRouter Child Keys

Every FlowDesk user gets a runtime OpenRouter child key provisioned by the server using `OPENROUTER_MANAGEMENT_API_KEY`.

Key naming:

```text
flowdesk:user:<userId>:<email>
```

Runtime selection:

- If the current user has an active child key, use it for AI calls.
- If not, create it on first AI use.
- Store the raw child key encrypted with the existing `lib/crypto.ts` helpers.
- Store the OpenRouter key hash and label so the key can be updated, disabled, rotated, or correlated with OpenRouter dashboard data.

Limits:

- Default child key credit limit should come from `OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD`.
- Default reset should be monthly.
- Internal `AiBudget` remains the product-facing budget gate. OpenRouter key limits are a hard external guardrail.

Fallback:

- No silent fallback to OpenAI.
- In local development/tests, a single `OPENROUTER_API_KEY` may be used only when `OPENROUTER_MANAGEMENT_API_KEY` is absent and no user child key exists. This avoids blocking local dev.
- Production should require either provisioned child keys or a clearly configured service fallback flag. Default production behavior should fail closed.

### 2. Provider-Neutral AI Gateway

Create a single gateway module that all FlowDesk AI calls use.

Recommended module:

```text
lib/ai/openrouter.ts
lib/ai/gateway.ts
lib/ai/openrouter-keys.ts
```

The gateway should accept:

- `tenantId`
- `userId`
- `feature`
- `model`
- prompt/messages
- optional JSON schema
- estimated token/cost data for budget preflight

The gateway should return:

- parsed text or JSON output
- provider name (`openrouter`)
- model
- generation ID
- input/output tokens from provider response when present
- actual cost from provider response when present
- status and error metadata

Existing prompt builders and normalizers remain valuable. The migration should change transport and accounting, not rewrite every prompt.

Structured output:

- Use OpenRouter Chat Completions with `response_format` JSON schema where supported.
- Keep normalizer validation as a second line of defense.
- If a selected model does not support strict schema, fail clearly for features that require structured output rather than silently accepting prose.

### 3. Usage Ledger

Extend `AiUsageEvent` from tenant-only estimated accounting to user/provider-aware accounting.

New fields:

- `userId String?`
- `provider String @default("openrouter")`
- `providerKeyHash String?`
- `providerGenerationId String?`
- `inputTokens Int @default(0)`
- `outputTokens Int @default(0)`
- `totalTokens Int @default(0)`
- `actualCostUsd Float?`
- `estimatedCostUsd Float @default(0)` remains for budget preflight/fallback
- `errorCode String?`
- `errorMessage String?`

Existing settings usage summaries should continue to work and can gradually display user-level breakdowns.

### 4. Canonical Labels As The User-Facing Model

Use `FLOWDESK_GMAIL_LABEL_NAMES` as the source of truth for user-facing labels:

- `Needs Reply`
- `Needs Action`
- `Waiting On`
- `Read Later`
- `Handled`
- `Autodrafted`
- `Newsletter`
- `Marketing`
- `Notification`
- `Calendar`

Remove `Important` and `Other` from top-level Mail tabs.

Product mapping:

| Label | Backing state |
| --- | --- |
| Needs Reply | workflow status `needs_reply` |
| Needs Action | attention category `needs_action` and status `needs_reply` |
| Waiting On | workflow/user state `waiting_on` |
| Read Later | workflow/user state `read_later` |
| Handled | workflow status `done` / conversation closed |
| Autodrafted | draft status `proposed` or `approved` |
| Newsletter | email type `newsletter`, status closed/read-later depending current state |
| Marketing | email type `marketing`, status closed/read-later depending current state |
| Notification | email type `notification` or `fyi`, status closed/read-later depending current state |
| Calendar | email type `calendar`, status can remain actionable if the message needs scheduling/reply |

`Conversation.label` should not be shown as the main "label" selector anymore. It is a legacy/business metadata field. If Sales & CRM mode still needs `Lead`, `Pricing`, etc., expose those as sales metadata in `SalesPanel`, not in the general Mail label controls.

### 5. Manual Label Correction Learns

Manual label changes should update state and record a correction.

For every manual label change:

- Update `Conversation` and `ConversationState` to match the selected canonical label.
- Preserve user override metadata: `userOverride`, `labelCorrectedByUser`, `labelCorrectedAt`.
- Record `AuditLog` action `conversation.label_corrected`.
- Record `ClassificationCorrection` for learning. For content labels, store `newAttention` as a stable label/category key such as `newsletter`, `marketing`, `notification`, or `calendar`.
- Queue Gmail label writeback through `projectFlowDeskLabelsForConversation` or `queueFlowDeskLabelWriteback`.
- Revalidate inbox views.

Future classifier/rules behavior should use these corrections to suggest/activate sender rules. This phase only needs to make the correction data reliable.

### 6. Mail Top Tabs Stay Sticky In List And Detail

Create a shared Mail top context component that can render on:

- `/mail`
- `/conversations/[id]` desktop detail page

The tabs should be visually sticky at the top of the Mail content area, below the page header/search row. Opening an email should not remove or visually shift the tabs.

Behavior:

- `/mail?label=needs_reply` filters list/table by canonical label.
- Opening a row preserves `returnTo=/mail?label=...&q=...`.
- Detail page derives active label from `returnTo`.
- Detail page Mail tabs link back to `/mail?label=...`, not to the current conversation.
- The left list in the detail split should respect the same return label filter.

Backward compatibility:

- Continue accepting legacy `tab`, `status`, `attention`, and `type` query params.
- New UI links should emit `label`.

### 7. Label Dropdowns

Rename hover tooltip/copy from "Change tag" to "Change label".

The row hover dropdown and right-side thread control should show all canonical labels. The options should be grouped lightly:

- Action: Needs Reply, Needs Action, Waiting On, Read Later
- Done/AI: Handled, Autodrafted
- Categories: Newsletter, Marketing, Notification, Calendar

`Autodrafted` is normally AI-derived. It can be visible as a label/filter, but manual selection should be disabled or hidden unless there is an existing draft. The manual control should not create a fake draft.

Recommended UX:

- Row hover action: compact dropdown for quick relabeling.
- Thread sidebar: larger "Label" panel showing current labels as pills plus a select/menu.
- Show one short "Learning from this correction" status after save.

### 8. Assistant UX

Borrow the screenshot structure from Inbox Zero while keeping FlowDesk's narrower action model.

Assistant layout:

- Keep thin `AppRail`.
- Remove `AppSidebar`.
- Header: `AI Assistant` or `Assistant`; secondary action `AI Chat`.
- Dismissible getting-started panel can be static/local for now or omitted if it causes scope creep.
- Horizontal tabs: Rules, Test, History, Settings.
- Content width should feel like a productive table/work surface.

Rules tab:

- Summary row: active rules, draft rules, learned sender rules, last dry-run.
- Rules table columns: Enabled, Name, Prompt/Condition, Action, Last tested, Menu.
- Actions render as chips: `Label as 'Newsletter'`, `Draft Reply`, `Archive`, `Notify Sender` only if supported by current backend.
- Use real `AgentRule` and `SenderRule` data.
- No fake rows. If empty, show a useful setup empty state and route to create/train.

Test tab:

- Do not ask for raw rule ID.
- Server-load active/draft rules into a select.
- Provide search/sample controls over recent emails.
- Run existing `/api/agent-rules/dry-run`.
- Show sample size, matched count, skipped count, planned Gmail labels, automation level, and matched conversations with evidence.

History tab:

- Use `AuditLog`, but render human-readable rule events.
- Group by day.
- Show action chips and links to the relevant rule where possible.
- Include rule version and dry-run events.

Settings tab:

- Card list like the screenshot:
  - Auto draft replies
  - Draft confidence
  - Follow-up reminders
  - Digest
  - Writing style
  - Personal instructions
  - Email signature if already supported, or an explicitly disabled setting row only when there is a real route planned
- Keep `TrainAgentPanel`, but frame it as personal instructions/rules training.
- Settings must not describe unavailable destructive automations as if they exist.

## Data Model

### New `OpenRouterUserKey`

Add a model:

```prisma
model OpenRouterUserKey {
  id                   String   @id @default(cuid())
  tenantId             String
  userId               String   @unique
  keyHash              String   @unique
  keyLabel             String
  encryptedApiKey      String
  limitUsd             Float?
  limitReset           String?
  disabled             Boolean  @default(false)
  lastProvisionedAt    DateTime @default(now())
  lastUsedAt           DateTime?
  lastError            String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  tenant               Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([disabled])
}
```

Add relations:

- `Tenant.openRouterUserKeys`
- `User.openRouterUserKey`

### `AiUsageEvent`

Extend the existing model instead of replacing it. Existing summaries can read `actualCostUsd ?? estimatedCostUsd`.

## Environment

Replace public/runtime docs in `.env.example`:

```text
OPENROUTER_API_KEY=""
OPENROUTER_MANAGEMENT_API_KEY=""
OPENROUTER_MODEL="anthropic/claude-sonnet-4.5"
OPENROUTER_LEARNING_MODEL="anthropic/claude-haiku-4.5"
OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD="10"
OPENROUTER_HTTP_REFERER="https://flowdeskinbox.com"
OPENROUTER_APP_TITLE="FlowDesk Inbox"
```

Keep `OPENAI_API_KEY` only if tests still need a compatibility shim during migration. The user-facing app should not require it.

## Error Handling

OpenRouter provisioning:

- Missing management key: fail closed in production; allow configured dev fallback.
- Create-key 401/403: show admin configuration error.
- Create-key 429/5xx: retry once with backoff, then record `lastError` and fail current AI request.
- Disabled child key: attempt re-enable only through explicit admin/rotation path, not automatically.

Runtime calls:

- 401/403: mark child key error and surface "AI provider key unavailable".
- 402/payment/limit: record blocked usage and show a budget/credit-limit message.
- 429/5xx/provider overloaded: retry according to existing provider retry policy where safe.
- Invalid JSON: record failed usage, include provider generation ID if present, and raise existing normalizer error.

No AI request failure should mutate Gmail state.

## Testing Strategy

Unit tests:

- OpenRouter key provisioning request/response parsing.
- Runtime client sends `user`, referer/title headers, model, and JSON schema.
- Usage recorder stores provider generation ID, actual cost, and user ID.
- Label taxonomy maps all canonical labels to query filters and state updates.
- Manual label correction records audit/correction and queues Gmail label projection.
- Mail tab compatibility accepts old `tab` but emits new `label`.
- Assistant history presenter converts audit action strings to human-readable rows.

Route/component tests:

- `/mail` renders canonical labels, not `Important` or `Other`.
- Conversation detail renders the Mail top tabs above the split view.
- Row hover button says "Change label".
- Label dropdown includes Newsletter, Marketing, Notification, and Calendar.
- Assistant Test page does not expose raw rule ID input.

Focused verification:

- `npx vitest run tests/openrouter-provider.test.ts tests/openrouter-keys.test.ts`
- `npx vitest run tests/mail-label-tabs.test.ts tests/conversation-label-route.test.ts`
- `npx vitest run tests/dashboard-ui-contracts.test.ts tests/assistant-tabs.test.ts tests/agent-rule-dry-run.test.ts`
- `npm run build`

## Non-Goals

- No auto-send expansion.
- No auto-delete.
- No new full email client behavior.
- No arbitrary custom labels in this phase. Users get the canonical FlowDesk labels first; custom labels can come later.
- No Outlook writeback parity in this phase.
- No new paid billing system beyond OpenRouter child key limits and existing AI budget controls.
- No fake Assistant sample data.

## Open Questions For Later

- Should child keys be created at signup or first AI use? This spec recommends first AI use to avoid provisioning unused accounts.
- Should users see their own AI spend directly in Settings? Recommended after backend accounting lands.
- Should custom user-created labels become teachable labels? Defer until canonical labels feel solid with real testers.
