# Phase 1 Completion Design

## Purpose

Close the remaining gaps between the existing Phase 1 infrastructure and the "never drop the ball" product story. Three open PRs were merged (explain thread, weekly value report, lead follow-up sequences) and five targeted gaps on `main` were addressed.

## Scope

This spec covers only the gap-closing work. It does not add new Phase 2 features.

## What Was Already Done (Pre-Merge)

- Daily command center with conversation classification, follow-up tracker (amber inbox section), and safely-ignored collapsible.
- PersonMemory schema, `syncPersonMemory` lib, and relationship panel on conversation page.
- ConversationState persisted per-conversation via `syncConversationWorkItems`.
- Tasks page with inline due-date editing and overdue/upcoming sections.
- Leads page with stage pipeline.
- Approval queue with bulk approve/reject and expandable draft preview.
- Confidence score shown in WorkItemsPanel.
- Reports and Explain Thread links already in inbox nav.

## Merged PRs

- `feat/lead-follow-up-sequences` — staged follow-up sequences (first, second, close) on the leads page and via the follow-up batch job.
- `feat/explain-thread` — "Explain This Thread" panel on the conversation page, with structured what-happened / what-they-want / risks / suggested-next-step output.
- `feat/weekly-value-report` — `/reports` page with weekly metrics: drafts created, drafts sent, tasks extracted, leads detected, follow-ups queued, approvals decided, conversations triaged, estimated minutes saved.

## Gap Changes

### 1. Auto-Draft Follow-Up on Conversation Open

**Problem:** The follow-up batch job creates `AgentJob{trigger:"follow_up", status:"pending"}` but generates no draft. Users see the amber tracker but open a blank thread.

**Solution:** When `ConversationPage` loads with a pending follow-up job and no existing draft, render `AutoDraftTrigger` — a zero-UI client component that fires `POST /api/conversations/[id]/draft/suggest` on mount and refreshes the page on success.

**Condition:** `pendingFollowUpJob !== null && !conversation.draft && channel.type === "email" && businessProfile !== null`

**Files:** `app/conversations/[id]/AutoDraftTrigger.tsx` (new), `app/conversations/[id]/page.tsx` (query + render).

### 2. Sensitive Draft Warning Banner

**Problem:** When a draft is generated for a sensitive thread, risk metadata exists in the draft but nothing visible warns the user before they hit Approve & Send.

**Solution:** In `AIDraftPanel`, when `hasDraftText && (metadata?.riskLevel === "high" || metadata?.escalationReason)`, show an amber banner above the textarea: "Sensitive content detected. Review carefully before sending." with the escalation reason appended if present.

**File:** `app/conversations/[id]/AIDraftPanel.tsx`.

### Already-Addressed Gaps (No New Code Needed)

- **Due-date editing** — `TaskList.tsx` already had inline date input hitting `/api/tasks/[id]/due`.
- **PersonMemory on Gmail sync** — `syncGmailChannel` already calls `syncConversationWorkItems`, which calls `syncPersonMemory`.
- **Reports link in inbox nav** — Already present in both desktop and mobile nav.

## Phase 1 Success Criteria Checklist

- [x] User can open FlowDesk and see a command center that says what to do first.
- [x] Stale conversations surface in the follow-up tracker; opening one shows a ready draft.
- [x] Sensitive threads show a visible warning before sending.
- [x] Tasks are extractable with due dates editable inline.
- [x] Leads are detectable with a stage pipeline.
- [x] Approval queue allows bulk review with draft preview.
- [x] Relationship context (summary, promises, questions, preferences) shows per conversation.
- [x] Weekly value report shows measurable work FlowDesk did.
- [x] Explain Thread answers: what happened, what they want, what to do, risks.
- [x] Lead follow-up sequences move stale leads through first / second / close stages.
- [x] "Safely ignored" section gives permission to ignore low-priority threads.
