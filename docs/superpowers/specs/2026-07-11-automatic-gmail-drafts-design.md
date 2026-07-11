# Automatic Gmail draft creation, backfill, and draft-quality gates

Date: 2026-07-11
Status: Approved for implementation

## Problem

`docs/product-direction.md` and `docs/CURRENT_STATE.md` both describe Level 3
("Create Gmail drafts") as automatic — the user should never have to open the
FlowDesk web app for a draft to appear in Gmail. That behavior was never
built. Tracing every caller of `generateDraftReply()` shows exactly two:

- `POST /api/conversations/[id]/draft/suggest` — fires only when a user opens
  a conversation in the FlowDesk web app and manually clicks the AI-draft
  trigger.
- `lib/agent/autopilot.ts` — Level 5 only, generates and **sends** immediately;
  it never creates a Gmail-native draft.

There is no automatic trigger equivalent to label projection
(`projectFlowDeskLabelsForConversation`, called automatically from
`work-item-sync.ts` right after every classification). Labels show up in
Gmail without user action; drafts do not. This is the root cause of "I don't
see any drafts in my Gmail inbox."

Separately: the deterministic classifier (`lib/agent/email-classifier.ts`)
has specific, well-tested rules for newsletter/marketing/notification mail,
but falls through to a generic catch-all when nothing else matches
(`needs_reply`, confidence exactly `0.7`, reason `"Human message likely
expects a reply."` — line 474, the only rule that returns that exact
confidence). Real newsletters/announcements/link-shares that don't trip the
earlier, more specific rules land in that bucket. Auto-generating drafts
naively on top of today's classification would draft-spam those threads.

## Goals

1. Gmail-native drafts appear automatically for Level 3+ tenants, with no
   manual web-app visit required — the documented behavior, actually built.
2. Before auto-generating, gate out conversations that don't really need a
   reply, specifically the ones slipping through the classifier's generic
   fallback. Cheap for the common case (most classifications hit a specific
   rule and skip the gate entirely).
3. When the gate overrules a `needs_reply` classification, correct the
   conversation's tag (and its Gmail label) rather than silently skipping —
   the mistake shouldn't persist elsewhere in the product.
4. When a tenant raises automation level to 3+, offer to backfill drafts for
   existing conversations that need one, respecting the same gate.
5. Every draft — manual, automatic, backfilled, or autopilot-approved — passes
   through the same sanitizer before being saved/sent, closing the gap where
   autopilot's auto-send path (Level 5) writes straight to Gmail/the customer
   with zero content sanitization today.

## Non-goals

- Rewriting or retraining the deterministic classifier itself. It is
  deliberately left as-is except for the narrow retag correction in this
  spec, scoped to conversations the new gate actually overrules.
- A general-purpose "AI re-checks every classification" pass. The gate only
  runs for Level 3+ tenants on the ambiguous fallback bucket — proportional
  to actual auto-draft usage, not a blanket reclassification sweep.
- Confidence-gated auto-drafting and style-mirroring — both already exist
  (`lib/agent/autopilot.ts`, `lib/agent/autonomy.ts`, `lib/agent/policy.ts`
  for per-category confidence thresholds; `lib/agent/reply-learning.ts` /
  `lib/ai/prompts/learned-reply-profile.ts` for style).
- Prompt-injection scanning and language detection — deferred, tracked
  separately.

## Architecture

### Shared draft-generation function

Extract the context-gathering → prompt-building → generate → sanitize →
persist → queue-Gmail-writeback sequence currently inlined in
`app/api/conversations/[id]/draft/suggest/route.ts` into
`lib/agent/draft-generation.ts`:

```ts
export async function proposeDraftForConversation(input: {
  tenantId: string
  conversationId: string
  userInstruction?: string | null
  source: "manual" | "automatic" | "backfill"
}): Promise<ProposeDraftResult>
```

Three callers:
- `draft/suggest/route.ts` — `source: "manual"`, unchanged behavior, gate
  never applies.
- New automatic hook in `work-item-sync.ts` — `source: "automatic"`, gate
  applies.
- New backfill endpoint — `source: "backfill"`, gate applies.

This is also the single choke point for the draft sanitizer (goal 5), so
manual/automatic/backfill drafts are sanitized identically.

`autopilot.ts`'s Level 5 auto-send path calls `generateDraftReply()`
directly (it doesn't create a Gmail draft, it sends). It gets its own
sanitizer hook (see "Draft sanitizer" below) rather than being folded into
`proposeDraftForConversation`, since its persistence/send flow is materially
different.

### 1. Pre-draft eligibility gate

New function in `lib/agent/draft-generation.ts`:

```ts
async function resolveDraftEligibility(input: {
  tenantId: string
  conversationId: string
  classification: { emailType: string; attentionCategory: string; confidence: number; reason: string }
  message: { subject: string; body: string; fromEmail: string; headers?: Record<string, string> }
}): Promise<{ eligible: boolean; correctedEmailType?: EmailType; correctedAttentionCategory?: AttentionCategory; reason: string }>
```

Only invoked when `classification.emailType === "needs_reply" &&
classification.confidence <= 0.7` (the fallback bucket) **and** the tenant's
automation level is 3+. Specific-rule matches (confidence > 0.7, or any
non-`needs_reply` type) skip the gate entirely — zero added cost for the
common case.

Two layers, cheapest first:

1. **Deterministic recheck** — reuses signals already computed inside
   `classifyEmailType` (list-unsubscribe/bulk-list header presence, sender
   subdomain patterns) via a small exported helper
   (`hasBulkMailSignals(input): boolean`) refactored out of
   `email-classifier.ts`'s existing internal checks. If bulk-mail signals are
   present despite falling through the specific newsletter/marketing rules,
   reject without an AI call, correcting to `emailType: "newsletter"`,
   `attentionCategory: "read_later"` (the same bucket the specific newsletter
   rule already targets — this path only catches cases that share its
   signals but missed its exact pattern match).
2. **LLM check** (only if step 1 doesn't reject) — a cheap, JSON-schema-
   constrained call: *"Does this email expect a personal reply from the
   recipient, or is it one-way (announcement/share/newsletter/no response
   expected)?"* Returns `{ needsReply: boolean, suggestedEmailType: EmailType,
   suggestedAttentionCategory: AttentionCategory, reason: string }`. Follows
   the existing `runAiJsonFeature` gateway pattern (budget checks, usage
   recording) under a new feature key `"draft_gate.eligibility"`.

### 2. Retag on disagreement

When the gate rejects, `proposeDraftForConversation` (via
`resolveDraftEligibility`'s caller) updates `ConversationState.metadataJson`
(`emailType`, `attentionCategory`, `attentionReason`, `attentionConfidence`,
`attentionSource: "draft_gate"`) to the corrected values — same shape
`work-item-sync.ts` already writes — then calls
`projectFlowDeskLabelsForConversation` to re-project the corrected Gmail
label, and writes an audit log entry (`draft_gate.reclassified`, payload:
conversationId, from/to emailType+attentionCategory, reason). This reuses
the existing audit timeline (`lib/agent/conversation-timeline.ts`) with no
new UI required — the correction is visible in the conversation's "what
FlowDesk did" timeline like any other classification change.

The retag is an AI-detected correction, not a user override — it does not
set `attentionCorrectedByUser`/`userOverride`, so an explicit user choice
still always wins over it on a future sync, same as today's rule-vs-AI
precedence.

### 3. Automatic draft trigger

In `work-item-sync.ts`, immediately after the existing classification block
(after line ~538, alongside the label-projection call at line ~201) add:

```ts
if (
  !hasUserOverrideOrLabelHold &&
  detectedAttentionCategory === "needs_reply" &&
  automationLevel >= 3 &&
  !conversation.draft // no existing proposed/approved draft for this thread
) {
  await proposeDraftForConversation({
    tenantId: conversation.tenantId,
    conversationId: conversation.id,
    source: "automatic",
  })
}
```

`proposeDraftForConversation` internally calls `resolveDraftEligibility`
first; on rejection it performs the retag and returns without generating a
draft. Existing idempotency (draft cache key, `gmailDraftSourceInboundMessageId`)
already prevents regenerating a draft for a thread that hasn't received new
inbound mail, so this is safe to call on every sync.

`work-item-sync.ts` does not currently fetch automation level anywhere —
this adds one `getAutomationLevel(conversation.tenantId)` call, guarded so it
only runs when `detectedAttentionCategory === "needs_reply"` (the only case
that could trigger a draft), not on every sync.

### 4. Backfill on level upgrade

`PATCH /api/autopilot-settings` already detects and audits a level change
(`from`/`to`). When `to >= 3 && (existing?.automationLevel ?? 0) < 3`, the
response includes `backfillAvailable: true` plus a count of eligible
conversations (status `needs_reply`, no existing draft) — cheap to compute,
no AI calls yet.

New endpoint `POST /api/autopilot-settings/backfill-drafts`:
```ts
{ scope: "all" | "last_n"; n?: number } // "needs reply" filter is implicit — always applied
```
Iterates matching conversations (capped, e.g. 50 per request, to bound AI
spend on one click) and calls `proposeDraftForConversation({ source:
"backfill" })` for each — same gate, same retag behavior. Returns per-
conversation results (`drafted`, `skipped_not_eligible`, `skipped_error`) so
the UI can show a summary ("Created 7 drafts, skipped 3 that didn't need a
reply").

UI: `AutopilotSettingsForm.tsx` shows a one-time banner immediately after a
level change crosses the 2→3 threshold (client-side, driven by the PATCH
response — no new persisted "prompted" flag needed, since it only shows
once per level-change action, not on every page load) with three actions:
"Create for all," "Last 10," "Dismiss." Uses the existing settings-panel
styling (see `AutomationRunHistory.tsx` for the conversational tone already
used near this UI).

### 5. Draft sanitizer

New module `lib/agent/draft-sanitizer.ts`:

```ts
export function sanitizeDraftText(text: string): {
  text: string
  autoFixed: string[]   // patterns silently stripped
  flagged: string[]     // issues that block silent use
}
```

Silently stripped (near-zero false-positive risk, patterns already proven in
`lib/agent/reply-learning.ts`'s `sanitizeOutboundReply`):
- Quoted-thread bleed (`QUOTED_THREAD_PATTERNS`-equivalent: `"On ... wrote:"`,
  `"From: ..."`, `"--- Original Message ---"`, and lines starting with `>`).
- A short, explicit list of AI-preamble openers ("Here's a draft reply:",
  "Sure, here's a response:", "Draft:") if they appear as the first line.

Flagged, never silently used:
- Unresolved template placeholders (`[Client Name]`, `{{...}}`, bracketed
  all-caps like `[INSERT PRICE]`).
- Raw HTML tags or stray markdown (`<div>`, `**bold**`, `` ` ``) in what
  should be plain text.
- Empty or under-12-character result after stripping.

Safety cap: if stripping would remove more than 40% of the original text
length, abort the strip and add to `flagged` instead of mutating.

Integration:
- **`proposeDraftForConversation`** (manual/automatic/backfill): if
  `flagged.length > 0`, mirror the existing `writingPreferenceFailures`
  retry-once pattern in `draft/suggest/route.ts` — regenerate once; if still
  flagged, save the draft as `status: "proposed"` with the flags recorded in
  `Draft.metadataJson.sanitizerFlags` rather than blocking outright (a
  proposed draft always needs human review before it reaches Gmail/is sent,
  so flagging-not-blocking is safe here) . Auto-fixed text is used as-is
  with `sanitizerAutoFixed` recorded in metadata for audit visibility.
- **`autopilot.ts`** (Level 5 auto-send): if `flagged.length > 0`, do **not**
  auto-send. Fall back to `status: "proposed"` (same as today's non-eligible
  path) instead of `"approved"`, and audit-log
  `autopilot.draft_held_for_sanitizer` with the flags. This is the actual
  safety fix — today this path sends with zero content checks.

## Data model changes

None required. `ConversationState.metadataJson` and `Draft.metadataJson` are
free-form JSON and already carry the analogous fields this spec adds
(`attentionSource`, `sanitizerFlags`, etc. — same pattern as existing keys
like `autoSendEligible`, `autoSendHoldReason`).

## Testing strategy

- `lib/agent/draft-sanitizer.ts`: unit tests per pattern (quoted-thread
  strip, preamble strip, placeholder flag, HTML flag, 40% safety cap,
  empty-after-strip).
- `resolveDraftEligibility`: unit tests with mocked classification input —
  specific-rule classifications skip the gate (no AI call), fallback-bucket
  classifications with bulk-mail signals reject deterministically (no AI
  call), ambiguous fallback-bucket classifications call the mocked AI gate
  and respect its verdict.
- `work-item-sync.ts` automatic trigger: extend existing sync tests to cover
  Level 3+ triggers a draft, Level <3 does not, existing draft present does
  not re-trigger, gate rejection retags without drafting.
- `proposeDraftForConversation`: integration-style test per source
  (`manual`/`automatic`/`backfill`) confirming identical sanitizer/gate
  behavior.
- `autopilot.ts`: extend existing tests to cover the sanitizer-flagged case
  falling back to `proposed` instead of auto-sending.
- Backfill endpoint: test scope `all` vs `last_n`, cap enforcement, and the
  per-conversation result summary.

## Rollout

Single PR, since all five pieces share the extracted
`proposeDraftForConversation` function and would otherwise require
duplicating the sanitizer/gate wiring across two branches. Behind no feature
flag — the automatic trigger only activates for tenants already at Level 3+
(an explicit, audited, user-initiated choice), so no existing tenant's
behavior changes without them having already opted in by raising their
level.
