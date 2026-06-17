# FlowDesk Phase 3 — Personal Chief of Staff

**Date:** 2026-06-17  
**Status:** Draft  
**Features:** #33 VIP Protection, #34 Smart Snooze, #16 Attachment Intelligence, #17 Natural-Language Search, #43 Ask My Inbox Chat, #38 Second-Brain Retrieval, #23 Phishing Protection, #24 Auto-Unsubscribe, #21 Personal Life Admin Mode (completion)

---

## Goal

Make FlowDesk useful beyond business email. The user trusts it to catch personal obligations, protect them from threats, and let them ask natural questions about their inbox.

---

## Sprint Slices

### v3.0 — Protection Layer
Features that extend the existing classifier pipeline. No new storage primitives beyond metadata fields.

1. **Personal life admin mode** (#21) — complete remaining detection flows
2. **VIP protection** (#33)
3. **Phishing/scam/fraud protection** (#23)
4. **Auto-unsubscribe and noise killer** (#24)

### v3.1 — Intelligence Layer
Features that require new data models and extraction infrastructure.

5. **Smart snooze / reply-later** (#34)
6. **Smart attachment intelligence** (#16)
7. **Second-brain retrieval** (#38)

### v3.2 — Conversational Layer
Features that build on the retrieval infrastructure from v3.1.

8. **Natural-language search** (#17)
9. **Ask My Inbox chat** (#43)

---

## Architecture Principles

All Phase 3 features follow the same conventions established in Phase 1/2:

- Classifiers live in `lib/agent/` as pure functions; one file per domain
- Classification runs in `work-item-sync.ts` fire-and-forget after Gmail sync
- Results are stored in `ConversationState.metadataJson` (no schema change needed for classifiers)
- New persistent data (VIP contacts, snooze reminders, attachments) gets dedicated Prisma models
- All API routes under `app/api/` with `tenantId` isolation
- Migration workflow: hand-write SQL → `prisma db execute --file` → `prisma migrate resolve --applied` → `prisma generate`
- No shadow DB

---

## v3.0 — Protection Layer

### Feature 1: Personal Life Admin Mode (#21) — Completion

**What's already shipped:** OTP, password reset, account verification, billing, delivery, and calendar RSVP detection; attention categories; action metadata badges on Home cards.

**What remains:**
- Bill/invoice detection: extract amount and due date from email body; create `InboxTask` with `dueAt`
- Travel confirmation: detect flight/hotel/car booking; create task with departure date
- Medical appointment: detect appointment reminders; create task with appointment date
- Subscription renewal: detect renewal notices with amount and renewal date
- School/academic: detect grade reports, schedule changes, enrollment deadlines
- Privacy UX: "Why does FlowDesk know this?" tooltip on life-admin badges

**Implementation:**
- Extend `lib/agent/email-classifier.ts` `detectActionType()` with new branches: `bill_due`, `travel_confirmation`, `medical_appointment`, `subscription_renewal`, `school_notice`
- For each branch, extract structured metadata: `{ type, amount?, currency?, dueAt?, description? }` → store in `InboxTask.metadataJson`
- Extend `work-item-sync.ts` to call new branches and create `InboxTask` records for actionable types
- New inbox filter tab: "Life Admin" — filters by `InboxTask.metadataJson.type` in the life-admin set
- Home command center: "Life Admin" section below "Bills & Deadlines", lists upcoming tasks grouped by type

**API routes:**
- No new routes; extends existing `POST /api/agent/work-item-sync` classification chain

**UX entry points:**
- Inbox: "Life Admin" attention filter tab
- Conversation page: life-admin badge below sender info showing extracted data ("Flight to NYC · June 22")
- Home: Life Admin section in command center cards

---

### Feature 2: VIP Protection (#33)

**New model:**
```
VipContact {
  id          String   @id @default(cuid())
  tenantId    String
  email       String
  domain      String?   -- match entire domain if set
  label       String?   -- "Mom", "Big Client", "Boss"
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tenant      Tenant   @relation(...)

  @@unique([tenantId, email])
  @@index([tenantId])
}
```

**Classification:**
- New file: `lib/agent/vip-detector.ts` — `detectVip(from: string, tenantId: string): Promise<{ isVip: boolean, label?: string }>`
- Queries `VipContact` by exact email match or domain suffix match
- Caches per-request to avoid N+1 on batch sync
- Sets `ConversationState.metadataJson.isVip = true` and `vipLabel = label`
- Forces `priority = 'urgent'` regardless of other classifier output

**API routes:**
- `GET /api/vip-contacts` — list all for tenant
- `POST /api/vip-contacts` — add new VIP (body: `{ email, domain?, label? }`)
- `DELETE /api/vip-contacts/[id]` — remove

**UX entry points:**
- Inbox: gold star `⭐` badge on VIP rows; VIP conversations surface at the top of Handle First
- Conversation page: gold "VIP — [label]" banner below thread header
- Settings `/settings`: "VIP Contacts" section with add/remove form
- Quick-add: "Add to VIPs" option in conversation page action menu

---

### Feature 3: Phishing/Scam/Fraud Protection (#23)

**New file:** `lib/agent/phishing-detector.ts`

**Signals (deterministic, no LLM):**
- Mismatched reply-to vs from domain
- Lookalike domains: `paypa1.com`, `arnazon.com`, `app1e.com` (homoglyph check)
- Impersonation keywords: IRS, PayPal, Apple ID, Google Account, Bank, Federal, SSA, Medicare in sender name combined with non-official domain
- Urgency + action link pattern: "verify your account immediately" + link within 48 hours
- Suspicious TLD patterns: `.xyz`, `.top`, `.click`, `.loan` combined with financial keywords
- Known phishing phrases: "you have won", "send gift cards", "wire transfer urgent"

**Result stored in `ConversationState.metadataJson`:**
```json
{
  "phishingRisk": {
    "verdict": "safe" | "suspicious" | "likely_phishing",
    "score": 0-100,
    "signals": ["mismatched_reply_to", "lookalike_domain"]
  }
}
```

**Rules:**
- `score < 30` → `safe` (no UI change)
- `score 30–69` → `suspicious` (amber warning)
- `score ≥ 70` → `likely_phishing` (red warning, excluded from autopilot drafts)

**False-positive UX:** "Mark as safe" button stores `metadataJson.phishingMarkedSafe = true`, clears warning

**API routes:**
- `POST /api/conversations/[id]/phishing-safe` — mark as safe

**UX entry points:**
- Inbox: red shield `🛡` badge on suspicious/phishing rows
- Conversation page: full-width amber/red banner "This email shows signs of phishing — do not click links or reply with personal information" + "Mark as safe" button
- Likely-phishing conversations are excluded from autopilot and AI draft suggestions

---

### Feature 4: Auto-Unsubscribe and Noise Killer (#24)

**No new model.** Extends existing `ConversationState.metadataJson` and Gmail API.

**Detection:**
- Parse `List-Unsubscribe` header (RFC 2369) from message headers during Gmail sync
- Scan body HTML for `href` containing `unsubscribe`, `optout`, `opt-out`, `remove` text
- Store in `metadataJson.unsubscribeUrl: string | null` and `metadataJson.isMarketing: boolean`
- Marketing/newsletter conversations automatically get attention category `quiet`

**Unsubscribe action:**
- New file: `lib/agent/unsubscribe.ts` — `unsubscribeConversation(tenantId, conversationId)` 
- Tries `List-Unsubscribe` header URL first — HTTP GET only (mailto: variant is skipped in v3.0); falls back to extracted body URL
- After unsubscribe: close conversation, archive in Gmail, log to `AuditLog`

**API routes:**
- `POST /api/conversations/[id]/unsubscribe` — trigger unsubscribe action

**UX entry points:**
- Inbox: "Unsubscribe" button visible on marketing rows in the quiet/noise tab
- Conversation page: "Unsubscribe & Archive" button in action bar for marketing emails
- Inbox quiet tab: "Unsubscribe All" bulk action for all marketing conversations in view

---

## v3.1 — Intelligence Layer

### Feature 5: Smart Snooze / Reply-Later (#34)

**New model:**
```
SnoozeReminder {
  id             String   @id @default(cuid())
  tenantId       String
  conversationId String
  userId         String
  snoozeUntil    DateTime
  reason         String?
  status         String   @default("pending")  -- pending | fired | dismissed
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  tenant         Tenant       @relation(...)
  conversation   Conversation @relation(...)

  @@index([tenantId, status, snoozeUntil])
}
```

**Snooze behavior:**
- Snoozed conversations: set `ConversationState.priority = 'snoozed'` (new priority value); hide from inbox list by default
- On `snoozeUntil` expiry: cron fires, resets priority to `normal`, sets `metadataJson.resurfacedFromSnooze = true`
- Resurfaced conversations appear at top of inbox with "⏰ Snoozed — time to reply" badge

**Quick snooze options (modal):**
- Tonight (9 PM)
- Tomorrow morning (8 AM)
- In 3 days
- Next Monday
- Custom date/time picker

**Cron:** `GET /api/cron/snooze-check` (hourly, CRON_SECRET protected) — fires all pending reminders with `snoozeUntil <= now()`

**API routes:**
- `POST /api/conversations/[id]/snooze` — body: `{ snoozeUntil: string, reason?: string }`
- `DELETE /api/conversations/[id]/snooze` — cancel active snooze
- `GET /api/cron/snooze-check` — cron route

**UX entry points:**
- Inbox: "Snooze" button (clock icon) on hover actions row (already has mark-read, close/reopen)
- Conversation page: "Snooze" button in action bar → quick-pick modal
- Inbox: "Snoozed" tab to browse all snoozed conversations

---

### Feature 6: Smart Attachment Intelligence (#16)

**New model:**
```
EmailAttachment {
  id                String   @id @default(cuid())
  tenantId          String
  messageId         String
  conversationId    String
  filename          String
  mimeType          String
  sizeBytes         Int
  gmailAttachmentId String?
  extractedText     String?   -- capped at 10 KB
  extractedDataJson Json?     -- structured fields
  processedAt       DateTime?
  createdAt         DateTime  @default(now())
  tenant       Tenant       @relation(...)
  conversation Conversation @relation(...)

  @@index([tenantId, conversationId])
}
```

**`extractedDataJson` schema:**
```json
{
  "type": "invoice" | "contract" | "receipt" | "form" | "itinerary" | "other",
  "amount": 1200.00,
  "currency": "USD",
  "dueDate": "2026-07-15",
  "parties": ["Acme Corp", "John Smith"],
  "keyTerms": ["net 30", "late fee 1.5%"],
  "summary": "Invoice #1042 from Acme Corp for $1,200 due July 15"
}
```

**Processing pipeline:**
- During Gmail sync: detect attachments via Gmail API `message.payload.parts`; create `EmailAttachment` rows with metadata only (no download yet)
- Background processing (`AgentJob{trigger: "process_attachment"}`): download attachment data → extract text
  - PDFs: use `pdf-parse` npm package (`npm install pdf-parse @types/pdf-parse`)
  - Images: skip for v3.0 (no OCR dependency)
  - Text/CSV: read directly
- LLM extraction (fire-and-forget via `AgentJob`): if mimeType is PDF and extractedText exists, call LLM to populate `extractedDataJson`
- Safety: never store raw binary attachment data; only extracted text (capped at 10 KB) and structured JSON

**API routes:**
- `GET /api/conversations/[id]/attachments` — list attachments with extracted data
- `POST /api/agent/process-attachment` — internal: process one attachment (called from AgentJob)

**UX entry points:**
- Conversation page: "Attachments" panel (collapsible, below messages) showing each attachment with extracted summary
  - Shows "Invoice · $1,200 · due July 15" instead of "invoice.pdf"
  - "View extracted data" toggle expands the full JSON summary
- Inbox: paperclip icon badge on conversations with attachments; if invoice/contract, shows amount as secondary label
- Home command center: "Pending Invoices" subsection (conversations with invoice attachments, dueDate in future)

---

### Feature 7: Second-Brain Retrieval (#38)

**No new model.** Extends `PersonMemory` with a `factsJson` field (added via migration).

**New field on PersonMemory:**
```sql
ALTER TABLE "PersonMemory" ADD COLUMN "factsJson" JSONB;
```

**`factsJson` schema:**
```json
[
  {
    "fact": "Prefers morning meetings",
    "sourceMessageId": "msg_abc123",
    "extractedAt": "2026-06-17T10:00:00Z",
    "category": "preference" | "commitment" | "context" | "relationship"
  }
]
```

**Extraction:**
- New file: `lib/agent/second-brain.ts` — `extractFacts(body: string, contactEmail: string, messageId: string): Promise<Fact[]>`
- LLM prompt: extract 0–3 durable facts about this person from this email — preferences, commitments they made, context about their situation, relationship signals
- Runs as `AgentJob{trigger: "extract_facts"}` fire-and-forget during classify pipeline, max once per message
- Deduplication: before storing, compare against existing facts; skip if semantically identical (substring match sufficient for v3.0)

**Retrieval:**
- `GET /api/second-brain/[contactId]` — return all facts for a contact, sorted by extractedAt desc
- `POST /api/second-brain/search` — body: `{ query: string }` — keyword search across `factsJson` for a tenant

**Integration with existing features:**
- Reply context (`lib/agent/reply-context.ts`): include top 5 facts for the contact when building draft context
- Explain thread panel: include relevant facts in context
- Ask My Inbox chat (v3.2): facts are a retrieval source

**UX entry points:**
- Conversation page: "What I know about [Name]" section (extends existing PersonMemory panel) with extracted facts listed; user can delete individual facts
- `/api/person-memory/[contactId]` PATCH route already exists — add `factsJson` to patchable fields

---

## v3.2 — Conversational Layer

### Feature 8: Natural-Language Search (#17)

**Approach: PostgreSQL full-text search** (tsvector/tsquery — no embeddings required, built into existing Postgres instance).

**Schema changes:**
```sql
-- Add search vector to Message
ALTER TABLE "Message" ADD COLUMN "searchVector" tsvector;

-- Populate on insert/update via trigger
CREATE FUNCTION message_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english',
    COALESCE(NEW.subject, '') || ' ' ||
    COALESCE(NEW.body, '') || ' ' ||
    COALESCE(NEW."fromEmail", '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "Message"
  FOR EACH ROW EXECUTE FUNCTION message_search_vector_update();

-- Backfill existing rows
UPDATE "Message" SET "searchVector" = to_tsvector('english',
  COALESCE(subject, '') || ' ' ||
  COALESCE(body, '') || ' ' ||
  COALESCE("fromEmail", '')
);

-- GIN index for performance
CREATE INDEX message_search_vector_idx ON "Message" USING GIN ("searchVector");
```

**Search query parsing:**
- `lib/agent/search.ts` — `searchMessages(tenantId: string, query: string)` 
- Converts natural-language query to tsquery: tokenize, remove stop words, join with `&` (AND) or `|` (OR) for quoted phrases
- Returns conversations (not individual messages) with matched message snippets

**API route:**
- `GET /api/search?q=<query>&limit=20&offset=0` — returns `{ conversations: ConversationSearchResult[], total: number }`
- `ConversationSearchResult`: conversationId, subject, participants, matchSnippet (highlighted excerpt), matchedAt

**UX entry points:**
- Search bar in inbox header (top of `AppListColumn.tsx` above the filter tabs)
- Pressing Enter or clicking search icon navigates to `/search?q=...`
- `/search` page: search results list with conversation cards + matched snippet
- Results are clickable and navigate to conversation page

---

### Feature 9: Ask My Inbox Chat (#43)

**Architecture: stateless RAG per query** (no persistent chat history in v3.0).

**New file:** `lib/agent/inbox-chat.ts` — `answerQuery(tenantId: string, query: string): AsyncIterable<string>`

**RAG pipeline:**
1. Parse intent from query (keyword extraction)
2. Search messages via tsvector (from #17)
3. Search PersonMemory facts (from #38)
4. Search EmailAttachment extracted data (from #16)
5. Build context: top 5 relevant message snippets + relevant facts + relevant attachment summaries
6. Stream LLM response with context, citing conversation IDs

**Questions it handles:**
- "Did anyone email about the Johnson contract?" → search + answer
- "What did Sarah say about the project timeline?" → PersonMemory + messages
- "Show me all invoices from last month" → attachment search by type + date
- "Who owes me money?" → invoice attachments with outstanding amounts
- "When is my next dentist appointment?" → life-admin tasks + medical detection
- "What's the status of the Acme deal?" → lead + sales signals + messages

**Response format:**
```json
{
  "answer": "Sarah emailed on June 14 saying the project would be ready by July 1.",
  "sources": [
    { "conversationId": "cid_abc", "subject": "Project Timeline Update", "snippet": "..." }
  ]
}
```

**Guardrails:**
- Tenant-isolated: only searches current tenant's data
- Read-only in v3.0: answers questions, does not take actions
- No persistent chat history stored
- LLM is given only extracted text/summaries, never raw email bodies (privacy)

**API route:**
- `POST /api/chat` — body: `{ message: string }` — streaming response (Server-Sent Events)

**UX entry points:**
- Chat icon in sidebar nav (`AppNav.tsx`) → `/chat` page
- `/chat` page: clean chat interface, text input, streaming response cards with clickable source links
- No chat history UI (stateless); each session starts fresh

---

## Data Migration Summary

| Slice | Model/Change | Migration Type |
|---|---|---|
| v3.0 | `VipContact` table | New table, hand-written SQL |
| v3.0 | No schema changes for phishing/unsubscribe/life-admin | `metadataJson` only |
| v3.1 | `SnoozeReminder` table | New table |
| v3.1 | `EmailAttachment` table | New table |
| v3.1 | `PersonMemory.factsJson JSONB` | ALTER TABLE |
| v3.2 | `Message.searchVector tsvector` + trigger + GIN index | ALTER TABLE + trigger |

Migration workflow for each: hand-write SQL file → `prisma db execute --file migrations/NNN.sql` → `prisma migrate resolve --applied NNN` → `prisma generate` → update `schema.prisma` to match.

---

## API Routes Summary

| Route | Method | Feature |
|---|---|---|
| `/api/vip-contacts` | GET, POST | VIP |
| `/api/vip-contacts/[id]` | DELETE | VIP |
| `/api/conversations/[id]/phishing-safe` | POST | Phishing |
| `/api/conversations/[id]/unsubscribe` | POST | Unsubscribe |
| `/api/conversations/[id]/snooze` | POST, DELETE | Snooze |
| `/api/cron/snooze-check` | GET | Snooze cron |
| `/api/conversations/[id]/attachments` | GET | Attachments |
| `/api/agent/process-attachment` | POST | Attachments |
| `/api/second-brain/[contactId]` | GET | Second Brain |
| `/api/second-brain/search` | POST | Second Brain |
| `/api/search` | GET | NL Search |
| `/api/chat` | POST (streaming) | Ask My Inbox |

---

## New Pages Summary

| Page | Feature | Description |
|---|---|---|
| `/search` | Natural-language search | Search results with conversation cards |
| `/chat` | Ask My Inbox | Chat interface with streaming answers |

---

## Settings Additions

| Setting Section | Feature | Fields |
|---|---|---|
| VIP Contacts | VIP Protection | Add/remove VIP contacts by email or domain |

---

## Dependency Order

```
#21 Life Admin (extend existing) — no deps
#33 VIP Protection — no deps
#23 Phishing — no deps
#24 Unsubscribe — no deps

#34 Snooze — no deps
#16 Attachments — no deps
#38 Second Brain — no deps (extends PersonMemory)

#17 NL Search — depends on: message data exists (always true)
#43 Chat — depends on: #17 (search), #38 (facts), #16 (attachment data)
```

v3.2 chat is the only feature with hard dependencies. All v3.0 and v3.1 features are independent.

---

## Out of Scope (v3.0–v3.2)

- SMS/Twilio notifications for VIP emails (Twilio removed from roadmap)
- Image OCR for attachment extraction (add in v3.3 if needed)
- Semantic/vector search (pgvector) — tsvector is sufficient for v3.0; upgrade path documented
- Persistent chat history — stateless per query in v3.0
- Chat that takes actions (send reply, snooze) — read-only in v3.0
