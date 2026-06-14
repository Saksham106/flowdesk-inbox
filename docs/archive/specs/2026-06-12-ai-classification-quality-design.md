# Design: AI Classification Quality & Account-Mode Fixes

Date: 2026-06-12

## Summary

Four interrelated fixes to bring FlowDesk's AI behavior in line with user expectations across personal and business accounts:

1. Reply-style learning reads from Gmail sent-mail history, not just FlowDesk-sent emails.
2. Personal accounts no longer receive business/sales-oriented AI prompts.
3. Newsletters, notifications, and automated emails are no longer classified as "Needs Reply".
4. Assistant context text matches the actual email type.

## Approach

All four fixes use Approach B: a new deterministic `email-classifier.ts` module (matching the existing `support-classifier.ts` / `sales-classifier.ts` pattern), targeted guards in `work-item-sync.ts`, Gmail SENT fetch at training time, and account-type-aware prompt switching. No Prisma schema migrations are required.

---

## Section 1: Reply-Style Learning from Gmail Sent History

### Problem

`collectOutboundReplySamples` queries only the FlowDesk `Message` table for `direction: "outbound"`. Gmail sync only imports `INBOX` threads — not sent mail. A freshly-connected Gmail account has zero outbound rows in the DB, causing the immediate error "Not enough sent messages to learn from."

### Changes

**`lib/google.ts`** — add `fetchGmailSentSamples(channelId, limit)`:
- Calls `gmail.users.messages.list({ labelIds: ["SENT"], maxResults: limit })`
- For each message ID, fetches the full payload and extracts body using the existing `extractBody` helper
- Returns `Array<{ text: string, createdAt: Date }>` — same shape as `OutboundReplySample`
- Does not write to the DB; used only at training time

**`lib/agent/reply-learning.ts`** — modify `trainLearnedReplyProfile`:
- After collecting DB samples, if count < 5 and a `channelId` is provided, call `fetchGmailSentSamples`
- Merge and deduplicate by text content; Gmail-fetched samples supplement DB samples (not replace)
- Require ≥ 5 combined samples to proceed
- If still < 5 after both sources: `"Could not find enough sent emails to learn from. FlowDesk checked your recent sent mail history but found fewer than 5 usable emails. Try sending a few emails first."`
- Store `sourceStatsJson.fromGmail` and `sourceStatsJson.fromDb` counts in the profile for transparency

**`app/settings/PersonalStylePanel.tsx`** — update copy:
- In-progress label: `"Learning from your recent sent emails..."`
- Success state shows `"X emails analyzed (Y from Gmail sent history)"` when Gmail samples contributed

---

## Section 2: Personal Account Prompt Separation

### Problem

`work-item-sync.ts` runs lead scoring and sales classification for all tenants regardless of `accountType`. The `buildLeadScoringPrompt` hardcodes business framing ("FlowDesk's lead intelligence engine. Score the sales potential…"). Personal account users see irrelevant business/sales AI behavior.

### Changes

**`lib/agent/work-item-sync.ts`**:
- At the start of `syncConversationWorkItems`, fetch `tenant.accountType` with a single `prisma.tenant.findUnique` (select `accountType` only)
- Gate `scoreLeadForConversation` behind `accountType !== "personal"`
- Gate `classifySalesSignals` the same way
- `classifySupportSignals` remains active for all accounts
- Store `accountType` in the local scope for use in email-type classification (Section 3)

**`lib/ai/prompts/classify.ts`**:
- Add `accountType?: "personal" | "business"` to `ClassifyPromptInput`
- When `accountType === "personal"`, `buildClassifyPrompt` returns a personal-account prompt:
  - System framing: "You are FlowDesk's email assistant for a personal inbox."
  - Focus: whether the email needs a human reply, urgency, sender relationship, task/action required, scheduling/follow-up
  - No mention of leads, sales potential, business owner, CRM, revenue, prospects, closing
  - `suggestedLabel` always `null` for personal accounts (no business labels)
- Business accounts receive the existing prompt unchanged

**`lib/agent/jobs.ts`**:
- Add tenant `accountType` lookup (or join) when fetching the conversation
- Pass `accountType` into `ClassifyPromptInput` when calling `classifyConversation`

---

## Section 3: Email Type Classification ("Needs Reply" Fix)

### Problem

Every conversation created during Gmail sync gets `status: "needs_reply"` unconditionally. There is no detection of no-reply senders, newsletters, GitHub/Docs/Azure/Supabase notifications, or marketing emails. The command center's `isSafelyIgnorable` FYI pattern is too narrow to catch these.

### New File: `lib/agent/email-classifier.ts`

Pure deterministic function — no DB, no AI calls, independently testable. Mirrors `support-classifier.ts` and `sales-classifier.ts`.

```ts
classifyEmailType(input: {
  fromEmail: string
  subject: string
  body: string
}) → { emailType: "needs_reply" | "notification" | "newsletter" | "marketing" | "fyi" }
```

Detection rules (evaluated in order, first match wins):

**Rule 1 — No-reply sender** → `"notification"`:
- `from` matches: `noreply@`, `no-reply@`, `donotreply@`, `do.not.reply@`, `notifications@`, `mailer-daemon@`, `bounce@`, `alert@`, `automated@`

**Rule 2 — Known notification sender domains** → `"notification"`:
- `from` domain matches: `github.com`, `googleusercontent.com`, `docs.google.com`, `drive.google.com`, `microsoft.com` (azure/devops subdomains), `porkbun.com`, `supabase.io`, `supabase.com`, `atlassian.net`, `jira.com`, `trello.com`, `linear.app`

**Rule 3 — Subject-based notification patterns** → `"notification"`:
- Subject matches: `[GitHub]`, `PR #`, `pull request`, `merged into`, `pushed to`, `invited you to`, `shared .* with you`, `Azure DevOps`, `Build succeeded`, `Build failed`, `Deployment`, `Your project on`, `Supabase`

**Rule 4 — Newsletter / marketing body patterns** → `"newsletter"`:
- Body contains: `unsubscribe`, `manage preferences`, `email preferences`, `view in browser`, `view this email in your browser`

**Rule 5 — Marketing subject patterns** → `"marketing"`:
- Subject matches: `% off`, `discount`, `limited time`, `special offer`, `early access`, `free trial`, `upgrade now`, `deal of the day`

**Rule 6 — Default** → `"needs_reply"`

### Changes

**`lib/agent/work-item-sync.ts`**:
- Call `classifyEmailType` using the conversation's first inbound message: `fromEmail` from `message.fromE164` (normalized via a local `extractEmail` helper — same pattern as `lib/google.ts`), `subject` inferred from the first line of the body or left empty, `body` from `message.body`
- Store `emailType` in `ConversationState.metadataJson`
- Runs for all accounts (personal and business)

**`lib/agent/command-center.ts`**:
- Add `getEmailType(conversation)` helper reading `conversationState.metadataJson.emailType`
- In `analyzeConversationForCommandCenter`: if `emailType` is `notification`, `newsletter`, or `marketing`, override state to `fyi_only`, priority `"none"`, with type-specific reason and nextAction
- Update `isSafelyIgnorable` to return `true` for these email types

| emailType | reason | nextAction |
|---|---|---|
| `notification` | "Automated notification — no reply needed." | "Review only if relevant." |
| `newsletter` | "Newsletter or marketing email." | "Unsubscribe if not relevant." |
| `marketing` | "Marketing / promotional email." | "No action needed." |

No schema migration required — `emailType` stored in the existing `metadataJson` JSON blob on `ConversationState`.

---

## Section 4: Assistant Context Alignment

### Problem

`HandleThisPanel` shows `assistantState.reason`. For notifications/newsletters at `needs_reply` status, this reads "Needs your reply." which is wrong.

### Changes

This is fully resolved by Section 3: once `emailType` overrides the command-center state to `fyi_only`, the reason and nextAction fields carry the correct text automatically.

**`app/conversations/[id]/page.tsx`** — suppress the "Handle this" button for `emailType` notification/newsletter/marketing:
- Replace the button with a neutral status line: "No reply needed for this email."
- The existing `canSuggest` gate already disables the button; this makes the intent explicit in the UI

---

## Section 5: Testing

**New: `tests/email-classifier.test.ts`**
- GitHub notification → `notification`
- Google Docs share (subject "shared a document with you") → `notification`
- Porkbun system email → `notification`
- Supabase project status → `notification`
- Body with "unsubscribe" link → `newsletter`
- Marketing subject "50% off today only" → `marketing`
- Normal personal email from friend → `needs_reply`
- No-reply sender → `notification`

**Update: `tests/command-center.test.ts`**
- Add cases with `conversationState.metadataJson.emailType = "notification"` — verify state is `fyi_only`, reason matches expected string

**New or update: `tests/reply-learning.test.ts`**
- Mock `fetchGmailSentSamples` returning ≥ 5 samples when DB has 0 — verify training succeeds
- Mock both sources returning < 5 — verify the informative error message
- Verify `sourceStatsJson.fromGmail` is populated correctly

**Update: `tests/agent-job-pipeline.test.ts`**
- Add personal-account test case — verify classify prompt does not include "lead", "sales potential", "business owner"

---

## Files Changed

| File | Change |
|---|---|
| `lib/google.ts` | Add `fetchGmailSentSamples()` |
| `lib/agent/reply-learning.ts` | Fall back to Gmail SENT fetch; updated error message |
| `app/settings/PersonalStylePanel.tsx` | Updated copy for training state and sample count |
| `lib/agent/work-item-sync.ts` | Account-type guard for lead/sales; store `emailType` in metadata |
| `lib/ai/prompts/classify.ts` | Add `accountType` param; personal-account prompt variant |
| `lib/agent/jobs.ts` | Pass `accountType` into classify call |
| `lib/agent/email-classifier.ts` | NEW — deterministic email type classification |
| `lib/agent/command-center.ts` | Read `emailType`; override state for notifications/newsletters |
| `app/conversations/[id]/page.tsx` | Suppress "Handle this" for no-reply email types |
| `tests/email-classifier.test.ts` | NEW — classifier unit tests |
| `tests/command-center.test.ts` | Add emailType override cases |
| `tests/reply-learning.test.ts` | New/updated Gmail fallback tests |
| `tests/agent-job-pipeline.test.ts` | Personal-account prompt test |

---

## Constraints

- No Prisma schema migration required
- No changes to email rendering, HTML sanitization, link handling, or sidebar layout
- Gmail connector sync behavior unchanged (INBOX only); SENT fetch is training-time only
- Business account behavior unchanged except for the email type classifier (which benefits both)
- All changes are backward-compatible: existing `ConversationState` rows without `emailType` fall through to current behavior
