# FlowDesk Inbox — Agentic Architecture Audit

Date: 2026-06-24
Scope: Evaluate how FlowDesk Inbox can evolve from "email app with AI calls" into a true AI inbox agent experience.
Constraint: Read-only inspection of codebase. No code changes in this document.

---

## 1. Current AI Architecture Summary

### Core AI Components

| Component | File | Type | Trigger |
|-----------|------|------|---------|
| **Classification** | `lib/agent/classify.ts` → `lib/ai/prompts/classify.ts` | LLM (gpt-4o-mini) | AgentJob (`classify` tool), `work-item-sync` |
| **Deterministic classification** | `lib/agent/email-classifier.ts` | Regex rules | `work-item-sync` (first inbound message) |
| **Draft generation** | `lib/ai/provider.ts` → `lib/ai/openai.ts` | LLM (gpt-5.4-mini) | User click "Draft with AI", `/draft/suggest`, autopilot |
| **Thread explanation** | `lib/ai/provider.ts` → `explainThreadWithOpenAI` | LLM | User click "Explain like I'm busy" |
| **Lead scoring** | `lib/agent/lead-scoring.ts` | LLM | `work-item-sync` (fire-and-forget), manual re-score |
| **Person memory** | `lib/agent/person-memory.ts` | Deterministic + LLM (gpt-5.4-mini) | `work-item-sync` (gated by AI usage policy) |
| **Meeting prep/follow-up** | `lib/ai/provider.ts` | LLM | User request via `/meetings` |
| **Reply learning** | `lib/agent/reply-learning.ts` | LLM (gpt-5.4-mini) | Manual trigger in Settings |

### Background Job System

| Cron Job | Route | Purpose |
|----------|-------|---------|
| `follow-up` | `/api/cron/follow-up` | Creates `AgentJob` for stale conversations |
| `gmail-watch` | `/api/cron/gmail-watch` | Renews Gmail push watches |
| `gmail-push-retry` | `/api/cron/gmail-push-retry` | Retries failed push notifications |
| `gmail-state-reconcile` | `/api/cron/gmail-state-reconcile` | Detects local/remote read_state drift |
| `gmail-writeback` | `/api/cron/gmail-writeback` | Retries failed Gmail mark-read writebacks |
| `lead-sequence` | `/api/cron/lead-sequence` | Queues follow-up jobs for leads |
| `value-snapshot` | `/api/cron/value-snapshot` | Weekly metrics snapshot |

### Key Data Models

| Model | Purpose |
|-------|---------|
| `AgentJob` | Orchestrates async work (classify, availability, autopilot) |
| `AgentToolCall` | Audit trail of each tool invocation per job |
| `ApprovalRequest` | Human-in-the-loop gate for drafts/actions |
| `AutopilotSetting` | Per-tenant automation config (thresholds, allow-list, caps) |
| `FollowUpSetting` | Per-tenant follow-up automation |
| `LearnedReplyProfile` | User's writing style (personal + business) |
| `PersonMemory` | Per-contact relationship memory (deterministic + LLM) |
| `SenderRule` | User-defined attention rules by sender/domain |
| `ClassificationCorrection` | User corrections for pattern learning |
| `AiUsageEvent` | Token/cost tracking per feature |
| `AiBudget` | Per-tenant spend limits |
| `AutopilotSetting.categoryThresholdsJson` | Per-intent confidence thresholds |

---

## 2. Why It Does/Doesn't Feel Agentic Today

### What Feels Agentic (Good)

| Feature | Why It Works |
|---------|--------------|
| **AgentJob orchestration** | Jobs have tool calls, audit trail, state machine (pending→running→completed/failed) |
| **Tool call audit trail** | Each LLM call + availability check logged as `AgentToolCall` |
| **Autopilot gate** | Multi-gate: policy → budget → confidence → per-intent threshold → daily cap → failure limit |
| **Approval queue** | `ApprovalRequest` + UI for draft review before send |
| **Memory with caching** | `PersonMemory` uses content hash + model version to avoid repeated LLM calls |
| **Budget enforcement** | `AiBudget` + `checkAiBudgetForTokens` pre-flight on every LLM call |
| **Deterministic fallbacks** | Classification, work items, person memory all have rule-based fallbacks |
| **Gmail push + incremental sync** | Real-time-ish sync with history cursor, fallback on cursor expiry |

### What Feels Like "AI Utility Calls" (Not Agentic)

| Gap | Evidence |
|-----|----------|
| **No proactive goals** | Agent only acts on: user click, cron schedule, or Gmail push. Never initiates work unprompted. |
| **No planning** | `AgentJob` runs one classification → policy check → maybe availability. No multi-step planning. |
| **No memory across sessions** | `AgentJob` is per-conversation, stateless. No cross-conversation goal tracking. |
| **No tool use beyond classification** | Tools: `classifyConversation`, `checkAvailability`. No email send, calendar create, web search, etc. |
| **No user preference learning loop** | `ClassificationCorrection` + `SenderRule` exist but aren't used to retrain prompts or adjust behavior |
| **Background jobs are cron-only** | All async work is time-driven (`cron`), not event-driven or goal-driven |
| **Draft generation is reactive** | Only fires on explicit user click ("Draft with AI") or follow-up cron |
| **No autonomous email send** | Autopilot exists but requires: learned profile + high confidence + low risk + daily cap + per-intent threshold. Practically never triggers. |
| **No cross-channel reasoning** | Email only. No calendar→email, email→task→calendar chaining. |

---

## 3. Highest-Leverage Agentic Features to Build First

### Stage 1: Better AI Inbox Assistant (2-4 weeks)

| Feature | Why High Leverage | Implementation |
|---------|-------------------|----------------|
| **Proactive draft suggestions** | User opens inbox → sees drafts already waiting for high-priority threads | Background job: for top 5 `needs_reply` conversations, generate draft + create `ApprovalRequest` |
| **Unified "Handle This" action** | Single button that: drafts reply + extracts tasks + creates follow-up + sets reminder | Extend `createAgentJob` to accept `goal` enum; add `plan` tool |
| **Cross-conversation follow-up** | "You asked John for pricing 3 days ago — he hasn't replied. Send nudge?" | Background job: scan outbound messages with no inbound reply > 72h |
| **Learned correction → prompt improvement** | User corrects attention → next classification uses corrected examples | Update `buildClassifyPrompt` to include recent `ClassificationCorrection` |

### Stage 2: Semi-Agentic Assistant with Approvals (4-6 weeks)

| Feature | Why High Leverage | Implementation |
|---------|-------------------|----------------|
| **Autonomous email send (guarded)** | Low-risk, high-confidence replies send automatically | Expand `attemptAutopilotSend` to support "send with delay" (user can cancel in 30s) |
| **Calendar booking agent** | "Book a 30min call next week" → agent finds slots, sends invite, confirms | New tool: `createCalendarEvent`; chain: classify → checkAvailability → createEvent → send confirmation |
| **Task→calendar→email chaining** | "Remind me to follow up Friday" → creates task + calendar hold + schedules email | New `AgentGoal` model; background executor that chains tools |
| **Proactive attachment intelligence** | "Invoice #1234 attached" → extracts amount, due date, creates task + calendar reminder | Background job on new message with PDF attachment |

### Stage 3: Proactive Inbox Operator (6-8 weeks)

| Feature | Why High Leverage |
|---------|-------------------|
| **Daily "agent ran" summary** | "I drafted 3 replies, booked 1 meeting, extracted 4 tasks, flagged 2 risks" |
| **Multi-step goal execution** | "Negotiate pricing with Acme" → agent drafts, sends, follows up, escalates |
| **Sender rule learning** | User corrects 2x → agent suggests "Auto-archive newsletters from beehiiv.com" |
| **Cross-channel context** | Calendar event + email thread + PersonMemory → unified briefing |

---

## 4. Suggested Agent State/Data Model

### New Models Needed

```prisma
// Durable agent goal — survives restarts, tracks progress
model AgentGoal {
  id              String       @id @default(cuid())
  tenantId        String
  conversationId  String?      // Optional: goal may span conversations
  type            String       // "draft_reply", "book_meeting", "extract_task", "follow_up", "negotiate"
  status          String       @default("pending") // pending, running, blocked, completed, failed
  payloadJson     Json         // Input parameters
  progressJson    Json?        // { step: "drafted", next: "await_approval" }
  parentGoalId    String?      // For sub-goal decomposition
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  completedAt     DateTime?
  error           String?
  tenant          Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversation    Conversation? @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  subGoals        AgentGoal[]  @relation("GoalHierarchy")
  parentGoal      AgentGoal?   @relation("GoalHierarchy", fields: [parentGoalId], references: [id])
  @@index([tenantId, status])
  @@index([conversationId])
}

// Tool registry for dynamic tool calling
model AgentTool {
  id          String   @id @default(cuid())
  name        String   @unique // "send_email", "create_calendar_event", "search_web", "create_task"
  description String
  schemaJson  Json     // JSON Schema for parameters
  enabled     Boolean  @default(true)
  riskLevel   String   @default("low") // low, medium, high
  requiresApproval Boolean @default(true)
}

// Execution log for each tool call in a goal
model AgentToolExecution {
  id            String   @id @default(cuid())
  goalId        String
  toolName      String
  inputJson     Json
  outputJson    Json?
  status        String   @default("pending") // pending, completed, failed, cancelled
  startedAt     DateTime @default(now())
  completedAt   DateTime?
  error         String?
  goal          AgentGoal @relation(fields: [goalId], references: [id], onDelete: Cascade)
  @@index([goalId, toolName])
}

// User-facing agent activity log (simpler than AgentToolCall)
model AgentActivityLog {
  id            String   @id @default(cuid())
  tenantId      String
  goalId        String?
  conversationId String?
  type          String   // "drafted_reply", "sent_email", "created_task", "booked_meeting", "extracted_lead"
  summary       String   // Human-readable: "Drafted reply to John re: pricing"
  detailsJson   Json?
  requiresReview Boolean @default(false)
  createdAt     DateTime @default(now())
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId, createdAt])
  @@index([conversationId])
}
```

### Extensions to Existing Models

```prisma
// Extend AgentJob to support goals
model AgentJob {
  // ... existing fields
  goalId        String?  // Link to AgentGoal
  goal          AgentGoal? @relation(fields: [goalId], references: [id])

// Extend ApprovalRequest for goal-aware approvals
model ApprovalRequest {
  // ... existing fields
  goalId        String?  // Which goal this approval unblocks
  step          String?  // "draft", "send", "calendar_invite", etc.
```

---

## 5. Suggested Approval Model

### Current State
- `ApprovalRequest` tied to `Draft` or `AgentJob`
- Binary: pending → approved/rejected
- No granularity: can't approve draft but reject send

### Proposed: Tiered Approval Gates

| Tier | Action | Auto-approve? | User Control |
|------|--------|---------------|--------------|
| **Tier 0** | Read-only (explain thread, summarize, extract task) | — | Never |
| **Tier 1** | Draft generation | Configurable per-intent | "Always ask" / "Auto-draft high-confidence" |
| **Tier 2** | Calendar hold / task creation | Configurable | "Ask for calendar holds > 30min" |
| **Tier 3** | Email send (draft approved → send) | **Never auto** without explicit user opt-in | "Send with 30s undo" / "Always ask" |
| **Tier 4** | Calendar event creation (send invite) | **Never auto** | "Always ask" |
| **Tier 5** | External API calls (web search, third-party) | **Never auto** | "Always ask" |

### Approval Model Updates

```prisma
model ApprovalRule {
  id          String   @id @default(cuid())
  tenantId    String
  scope       String   // "tenant", "conversation", "contact", "intent"
  scopeValue  String?  // conversationId, contactId, intent name
  action      String   // "draft", "send", "calendar_hold", "calendar_event", "web_search"
  mode        String   // "always_ask", "auto_if_confident", "never"
  confidenceThreshold Float? // For "auto_if_confident"
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId, scope])
}

model ApprovalRequest {
  // ... existing fields
  ruleId      String?       // Which rule governed this approval
  ruleMode    String?       // Snapshot of rule.mode at approval time
  step        String        // "draft", "send", "calendar_hold", etc.
  autoCancelAt DateTime?    // For "send with 30s undo"
}
```

---

## 6. Suggested Memory/Preference Model

### Current State
- `PersonMemory` (per-contact, deterministic + LLM)
- `LearnedReplyProfile` (per-channel, global style)
- `PersonalProfile` (personal tone)
- `SenderRule` + `ClassificationCorrection` (user corrections)
- `AutopilotSetting.categoryThresholdsJson` (per-intent thresholds)

### Gaps
1. **No prompt memory** — Corrections don't feed back into classification/draft prompts
2. **No intent-level preferences** — "I never want to auto-reply to pricing emails"
3. **No cross-conversation patterns** — "I always follow up on Monday mornings"
4. **No negative preferences** — "Never suggest calendar holds for internal emails"

### Proposed Additions

```prisma
// User preference for specific intents/actions
model AgentPreference {
  id              String   @id @default(cuid())
  tenantId        String
  scope           String   // "intent", "contact", "channel", "global"
  scopeValue      String?  // intent name, contactId, channelId
  preferenceType  String   // "never_draft", "never_send", "always_ask", "prefer_short", "prefer_formal"
  value           Json?    // e.g., { maxLength: 200, tone: "casual" }
  source          String   @default("explicit") // explicit, inferred, imported
  confidence      Float    @default(1.0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  expiresAt       DateTime?
  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId, scope, scopeValue])
}

// Learning events for prompt improvement
model LearningEvent {
  id              String   @id @default(cuid())
  tenantId        String
  type            String   // "correction", "reinforcement", "preference_inferred"
  sourceType      String   // "user_correction", "user_action", "pattern_detected"
  payloadJson     Json     // { intent, oldValue, newValue, conversationId, etc. }
  applied         Boolean  @default(false) // Has this been fed back to prompts?
  createdAt       DateTime @default(now())
  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId, type, applied])
}
```

### Prompt Improvement Pipeline

```typescript
// Background job: process LearningEvents → update prompts
async function retrainPrompts(tenantId: string) {
  const events = await prisma.learningEvent.findMany({
    where: { tenantId, applied: false, createdAt: { gte: lastRetrainAt } }
  })

  // Build few-shot examples for classification
  const corrections = events.filter(e => e.type === 'correction')
  const examples = corrections.map(c => ({
    input: c.payloadJson.messages,
    expected: c.payloadJson.newAttentionCategory
  }))

  // Update classification prompt with new examples
  await updatePromptVersion(tenantId, 'classify', { fewShotExamples: examples })

  // Update draft prompt with style corrections
  const styleCorrections = events.filter(e => e.type === 'style')
  await updatePromptVersion(tenantId, 'draft', { styleExamples: styleCorrections })

  await prisma.learningEvent.updateMany({
    where: { id: { in: events.map(e => e.id) } },
    data: { applied: true }
  })
}
```

---

## 7. UI Ideas for Making the Agent Feel Alive & Trustworthy

### Agent Activity Feed (Right Rail / Separate Page)

```
┌─ Agent Activity ────────────────────────┐
│ 🟢 2 min ago  Drafted reply to Sarah    │
│       re: "Pricing for Q3"             │
│       [Review] [Dismiss]                │
├─────────────────────────────────────────┤
│ 🟡 15 min ago  Extracted task from     │
│       Mike's email: "Send contract"    │
│       Due: Tomorrow 5pm  [View]         │
├─────────────────────────────────────────┤
│ 🔵 1 hour ago  Booked 30min with       │
│       Acme Corp for Thursday 2pm       │
│       [View invite]                     │
├─────────────────────────────────────────┤
│ 🟣 3 hours ago  Learned: "Archive      │
│       newsletters from beehiiv.com"    │
│       [Undo] [Keep]                     │
└─────────────────────────────────────────┘
```

### Trust Indicators

| Indicator | Purpose |
|-----------|---------|
| **Confidence badge** on every agent action | "92% confident this needs reply" |
| **"Why?" expandable** on every suggestion | Shows classification reason, policy gate, confidence |
| **Undo button** on every agent action | 30s undo for sends, instant revert for drafts/tasks |
| **Agent activity digest** | Morning email: "Yesterday I drafted 3 replies, booked 1 meeting..." |
| **Confidence threshold slider** in Settings | User sets: "Only auto-draft if >90% confident" |

### Proactive Nudges (Non-Intrusive)

```
┌─ Hey, quick question ───────────────────┐
│ You asked John for the contract 3 days  │
│ ago. No reply yet. Want me to nudge?    │
│ [Nudge now]  [Remind me tomorrow] [No]  │
└─────────────────────────────────────────┘
```

---

## 8. What to Build in the Next 2 Weeks (Stage 1 MVP)

### Week 1: Proactive Draft Generation + Unified "Handle This"

| Task | Owner | Effort | Files to Touch |
|------|-------|--------|----------------|
| Background job: generate drafts for top 5 `needs_reply` conversations | Codex | Medium | New `/api/cron/proactive-drafts`, `lib/agent/jobs.ts`, `lib/ai/provider.ts` |
| Create `ApprovalRequest` for each generated draft | Codex | Low | `lib/agent/autopilot.ts` (reuse draft logic), `prisma/schema.prisma` |
| UI: "Agent Drafts" section in Command Center | Codex | Medium | `app/components/HomeCommandCenter.tsx`, new `AgentDraftsSection.tsx` |
| "Handle This" → creates goal + runs classification + draft + task extraction | Codex | Medium | `lib/agent/jobs.ts`, new `lib/agent/goals.ts`, `app/conversations/[id]/HandleThisPanel.tsx` |
| Unified goal executor (run classification → draft → extract tasks in one job) | Codex | Medium | `lib/agent/jobs.ts`, `lib/agent/work-item-sync.ts` |

### Week 2: Cross-Conversation Follow-Up + Learning Loop

| Task | Owner | Effort | Files to Touch |
|------|-------|--------|----------------|
| Background job: detect outbound messages with no reply > 72h → create follow-up goal | Codex | Medium | New `/api/cron/cross-conversation-followup`, `lib/agent/follow-up.ts` |
| UI: "Agent suggested nudge" card in Command Center | Codex | Low | `app/components/HomeCommandCenter.tsx` |
| Feed `ClassificationCorrection` into classification prompt (few-shot) | Codex | Medium | `lib/ai/prompts/classify.ts`, new `lib/agent/preference-learning.ts` |
| Feed user style corrections into draft prompt | Codex | Medium | `lib/ai/prompts/draft-reply.ts`, `lib/agent/reply-learning.ts` |
| Add `LearningEvent` model + background retrain job | Codex | Medium | `prisma/schema.prisma`, new `/api/cron/retrain-prompts` |

---

## 9. What to Defer (Stage 2+)

| Feature | Reason to Defer |
|---------|-----------------|
| **Autonomous email send** | Requires robust trust UI, 30s undo, per-user opt-in, heavy audit |
| **Calendar booking agent** | Needs `createCalendarEvent` tool, availability chaining, invite send |
| **Multi-step goal execution** | Requires `AgentGoal` model, planner, sub-goal decomposition |
| **Attachment intelligence** | Needs PDF parsing, new background pipeline, storage |
| **Cross-channel reasoning** | Needs calendar integration, unified context model |
| **External tool calling (web search, APIs)** | Security review, sandboxing, approval model |
| **Multi-user/team goals** | Requires team model, shared inbox, collision detection |

---

## 10. What to Send Codex vs Claude Code

### Send to Codex (Implementation-heavy, well-scoped)

| Task | Why Codex |
|------|-----------|
| Background cron jobs (proactive drafts, follow-ups, retrain) | Repetitive pattern, clear spec, many similar existing cron jobs |
| New Prisma models + migrations (`AgentGoal`, `LearningEvent`, `AgentPreference`, `ApprovalRule`) | Mechanical, follows existing patterns |
| UI components for Agent Activity Feed, Drafts section | Component composition, follows existing patterns |
| `ApprovalRule` model + integration into `checkPolicy`/`autopilot` | Mechanical policy logic |
| `LearningEvent` background retrain job | Clear input/output, similar to existing cron jobs |
| Cross-conversation follow-up cron | Similar to existing `follow-up.ts` |

### Send to Claude Code (Reasoning-heavy, architectural)

| Task | Why Claude |
|------|------------|
| **AgentGoal model + planner design** | Needs architectural reasoning: how to decompose goals, handle failure, retry, human-in-the-loop |
| **Tool registry + dynamic tool calling** | Requires security reasoning: sandboxing, schema validation, approval gating |
| **Prompt improvement pipeline (LearningEvent → few-shot)** | Needs ML reasoning: example selection, deduplication, prompt versioning |
| **Approval model redesign (tiered gates, auto-cancel, rules)** | Policy/UX reasoning: trust, user control, failure modes |
| **Memory/preference model (AgentPreference, LearningEvent)** | Cognitive architecture: what to store, how to retrieve, privacy |
| **Autonomy evaluation redesign** | Current `evaluateAutonomy` is static; needs dynamic, context-aware |
| **Cross-channel context unification** | Calendar + email + memory + tasks → unified context for agent |

---

## Appendix: Key Files Referenced

- `lib/agent/jobs.ts` — AgentJob orchestration, classification, availability check
- `lib/agent/autopilot.ts` — Autopilot eligibility, draft generation, autopilot send
- `lib/agent/policy.ts` — Approval policy (risk, confidence, escalation)
- `lib/agent/classify.ts` — LLM classification wrapper
- `lib/ai/prompts/classify.ts` — Classification prompt + schema
- `lib/agent/email-classifier.ts` — Deterministic classification rules
- `lib/agent/work-items.ts` — Work item extraction (tasks, leads, state)
- `lib/agent/work-item-sync.ts` — Sync work items to DB after new email
- `lib/agent/person-memory.ts` — Per-contact memory (deterministic + LLM)
- `lib/agent/reply-learning.ts` — Learned reply profile training
- `lib/agent/follow-up.ts` — Follow-up batch job
- `lib/agent/autonomy.ts` — Autopilot eligibility evaluator
- `lib/ai/provider.ts` — Draft generation, thread explanation, meeting prep
- `lib/ai/openai.ts` — OpenAI client wrapper
- `lib/ai/budget.ts` — AI spend budget enforcement
- `lib/ai/usage.ts` — Token estimation + usage event recording
- `prisma/schema.prisma` — All data models
- `app/inbox/page.tsx` — Home page (command center, inbox list)
- `app/conversations/[id]/page.tsx` — Conversation detail page
- `app/components/HomeCommandCenter.tsx` — Command center UI
- `app/components/AutoRefresh.tsx` — Page auto-refresh component
- `app/components/GmailSyncControl.tsx` — Gmail sync UI + polling
- `app/components/AppListColumn.tsx` — Inbox list column (desktop)
- `app/components/EmailBodyIframe.tsx` — Email iframe renderer
- `app/api/cron/*` — All cron endpoints
