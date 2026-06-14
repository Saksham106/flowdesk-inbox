# v2.1 Design: Knowledge Base Source Management + Customer Support Mode

**Date:** 2026-06-12  
**Phase:** 2 — Business Revenue Inbox Agent  
**Slice:** v2.1  
**Features:** #8 Knowledge Base Source Management, #19 Customer Support Agent Mode  
**Approach:** Extend existing infrastructure — no new models, reuse work-item-sync pipeline, citations in existing AIDraftPanel metadata

---

## Goal

Make FlowDesk's knowledge base easier to populate (one URL → one doc) and make it automatically recognize support threads, answer FAQs from the KB, detect churn risk, and surface escalation-worthy threads — all without any user setup.

---

## 1. Schema Changes

**`KnowledgeDocument` model additions:**

```prisma
sourceUrl  String?
crawledAt  DateTime?
```

- `sourceUrl`: the URL the content was fetched from, or `null` for manually entered docs.
- `crawledAt`: timestamp of last crawl; reserved for future re-crawl logic.
- `sourceType` gains a new valid value: `"webpage"` (alongside existing `"faq"`, `"policy"`, etc.).

**`ConversationState.metadataJson` additions (no schema change):**

The existing `metadataJson: Json?` field gains three new optional keys written by the support classifier:

| Key | Type | Meaning |
|---|---|---|
| `isSupport` | `boolean` | Thread classified as a customer support request |
| `churnRisk` | `boolean` | Frustrated/cancellation language detected |
| `needsEscalation` | `boolean` | Angry + sensitive (money/legal/medical) signals |
| `suggestedKbDocId` | `string \| null` | ID of the best-matching KB doc for the thread's question |

**`Draft.metadataJson` additions (no schema change):**

| Key | Type | Meaning |
|---|---|---|
| `citedDocumentIds` | `string[]` | KB doc IDs the LLM cited when generating the draft |

---

## 2. Knowledge Base Source Management

### 2a. URL Crawl Endpoint

**`POST /api/knowledge-documents/crawl`**

Request body:
```json
{ "url": "https://example.com/faq", "title": "FAQ Page" }
```

Behavior:
1. Validate URL format (must be `https://`). Reject private/loopback IPs to prevent SSRF.
2. `fetch(url)` server-side with a 10-second timeout.
3. Strip HTML tags with a regex (`/<[^>]+>/g`), collapse whitespace, truncate to 8000 chars.
4. If `title` is not provided, attempt to extract `<title>` tag content; fall back to the URL hostname.
5. Create a `KnowledgeDocument` with `sourceType: "webpage"`, `sourceUrl: url`, `crawledAt: now`.
6. Write an audit log entry (`knowledge_document.crawl`).
7. Return the created document.

Error responses:
- `400` — invalid URL, private IP, or missing URL
- `422` — fetch succeeded but content was empty after stripping
- `502` — upstream fetch failed (timeout, DNS, non-2xx)

### 2b. `/knowledge-base` Management Page

A new page at `/knowledge-base` (business accounts only; personal accounts redirect to `/inbox`).

**Layout:**
- Header: "Knowledge Base" title, "Back to inbox" link.
- **URL import panel**: text input for URL + optional title, "Import page" button. On success, the new doc appears at the top of the list. On error, an inline error message.
- **Manual add panel**: expandable form with title + textarea for content + source type selector. Collapsed by default.
- **Document list**: one row per doc showing title, source type badge (`FAQ`, `Policy`, `Webpage`, etc.), word count, and a delete button. Sorted by `createdAt desc`.
- Empty state: "No knowledge documents yet. Add your FAQ, pricing page, or policies so FlowDesk can answer questions accurately."

**`/settings` change:**
Replace the inline KB form with a "Manage knowledge base →" link card.

---

## 3. Citations in Draft Replies

### 3a. Draft Prompt Schema Extension

Add `citedDocumentIds` to the JSON schema for draft generation:

```json
"citedDocumentIds": {
  "type": "array",
  "items": { "type": "string" },
  "description": "IDs of knowledge documents used to answer this email. Empty array if none."
}
```

The prompt instruction gains: *"If you used a knowledge document to answer a question, include its ID in `citedDocumentIds`."*

### 3b. Draft Metadata Storage

The draft API route stores `citedDocumentIds` in `Draft.metadataJson` alongside existing fields (`confidence`, `intent`, `escalationReason`).

### 3c. AIDraftPanel Citation UI

When `metadataJson.citedDocumentIds` is non-empty:
- A "Sources" row appears below the draft text, above the action buttons.
- Each cited doc renders as a small pill: `[FAQ] Pricing` or `[webpage] About page`.
- Clicking a pill opens a popover with the doc's title and full content (read-only).
- Citations are never included in the sent email — they are a user-facing confidence signal only.

---

## 4. Support Classification

### 4a. `classifySupportSignals` Function

New function in `lib/agent/support-classifier.ts`. Takes a conversation (messages + existing metadata) and returns:

```typescript
type SupportSignals = {
  isSupport: boolean
  churnRisk: boolean
  needsEscalation: boolean
  suggestedKbDocId: string | null
}
```

**Detection rules:**

| Signal | Trigger |
|---|---|
| `isSupport` | Support keyword pattern OR existing label `"Support"` OR repeated inbound messages with no resolution |
| `churnRisk` | Cancellation/frustration pattern + thread age > 3 days unanswered |
| `needsEscalation` | `churnRisk` AND sensitive pattern (legal/medical/money) already detected |
| `suggestedKbDocId` | Keyword overlap ≥ 3 terms between last inbound message and any KB doc content |

**Support keyword pattern:**
```
/\b(not working|broken|issue|problem|bug|glitch|error|complaint|refund|still waiting|never received|keep getting|frustrated|unacceptable|worst|terrible)\b/i
```

**Cancellation pattern:**
```
/\b(cancel|cancellation|unsubscribe|quit|leave|switching|going elsewhere|competitor|disappointed|done with)\b/i
```

### 4b. Integration into `work-item-sync.ts`

After the existing lead extraction block, run `classifySupportSignals`. If `isSupport` is true, upsert `ConversationState` with the support metadata keys. If `suggestedKbDocId` is non-null and keyword overlap is high, fire a draft suggestion (fire-and-forget, same pattern as lead scoring).

**KB match draft trigger:**
- Fetch the suggested KB doc.
- Call the existing draft generation path with the KB doc pre-emphasized in the prompt context.
- Queue as an `ApprovalRequest` (never auto-sends).
- Write an audit log entry (`support.kb_match_draft`).

### 4c. `CommandCenterState` Extension

Add `"support"` as a valid `CommandCenterState` value. Treated identically to `"needs_reply"` for priority, but routed to the `sections.support` bucket.

The command center `score()` function gives support threads a +15 bonus (below `risky_urgent` at +500 but above ordinary `opportunity`).

---

## 5. Support UI Surfaces

### 5a. `SupportPanel` Component

New `app/conversations/[id]/SupportPanel.tsx`. Rendered on conversation pages when `conversationState.metadataJson.isSupport === true`.

**Content:**
- Classification badges: `Support` (blue), `Churn Risk` (amber), `Needs Escalation` (red) — shown only when the respective flag is true.
- **Suggested answer block** (when `suggestedKbDocId` is set): shows KB doc title + first 300 chars of content + "Use this answer" button. Clicking it sets the draft textarea to the KB doc content (same mechanism as editing a draft).
- **Repeat contact** indicator: "N support threads from this contact" if the contact has > 1 support-classified conversation.

### 5b. Command Center Panel

- `CommandCenterPanel.tsx` count grid gains a **"Support"** chip alongside the existing chips.
- `DailyCommandCenter` type gains `sections.support` and `counts.support`.
- Support threads with `churnRisk` are shown with an amber accent in the top-actions list.

### 5c. Inbox Support Filter Tab

The status filter bar in `/inbox` gains a **"Support"** tab. When active, the conversation list filters to `conversationState.metadataJson.isSupport === true` conversations, sorted by churn risk first.

---

## 6. What Is Not In This Slice

- Re-crawl / refresh of URL-sourced KB docs (reserved for a future cron job).
- Multi-page / sitemap crawling.
- Semantic search over KB docs (keyword matching only for this slice).
- Support ticket numbering, SLA tracking, team assignment (Phase 5).
- Sales agent mode, CRM analytics, ROI trends (v2.2).

---

## 7. File Map

| File | Action |
|---|---|
| `prisma/schema.prisma` | Add `sourceUrl`, `crawledAt` to `KnowledgeDocument` |
| `lib/knowledge-document-types.ts` | Add `"webpage"` to valid source types |
| `app/api/knowledge-documents/crawl/route.ts` | New URL crawl endpoint |
| `lib/agent/support-classifier.ts` | New `classifySupportSignals` function |
| `lib/agent/work-item-sync.ts` | Wire support classification + KB-match draft trigger |
| `lib/agent/command-center.ts` | Add `"support"` state, `sections.support`, `counts.support` |
| `lib/ai/prompts/draft-reply.ts` | Add `citedDocumentIds` to JSON schema and prompt |
| `app/api/knowledge-documents/route.ts` | No change (already handles POST/GET) |
| `app/knowledge-base/page.tsx` | New KB management page |
| `app/knowledge-base/KbUrlImport.tsx` | Client component for URL import form |
| `app/knowledge-base/KbDocList.tsx` | Client component for document list |
| `app/conversations/[id]/SupportPanel.tsx` | New support panel for conversation pages |
| `app/conversations/[id]/page.tsx` | Render `SupportPanel` when `isSupport` |
| `app/inbox/page.tsx` | Add Support filter tab, pass support data |
| `app/inbox/CommandCenterPanel.tsx` | Add Support count chip |
| `app/settings/page.tsx` | Replace inline KB form with "Manage →" link |
| `tests/support-classifier.test.ts` | Unit tests for `classifySupportSignals` |
| `tests/kb-crawl.test.ts` | Unit tests for URL crawl route |
| `docs/MASTER_PRODUCT_PLAN.md` | Update features #8 and #19 status |
| `docs/CURRENT_STATE.md` | Document new capabilities |
| `docs/TODO.md` | Check off KB source management and support mode |

---

## 8. Trust and Safety

- URL crawl: reject `localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `169.254.x` (SSRF prevention). Max content length 8000 chars. 10-second timeout.
- KB-match draft: always queued as `ApprovalRequest`, never auto-sent.
- Support classification: additive to existing state; never overwrites a manually set `status` or existing `risky_urgent` state.
- Escalation flag: surfaces as a warning, never triggers any automated action.

---

## 9. Success Criteria

- User can paste a URL, click "Import", and see a populated KB document in under 5 seconds.
- Support-classified threads appear in a dedicated "Support" count in the command center.
- When a KB doc matches the thread question, a draft suggestion appears in the approval queue without any user action.
- Churn-risk threads are visually elevated in the inbox.
- All 260 existing tests continue to pass; new tests cover classifier, crawl validation, and citation plumbing.
