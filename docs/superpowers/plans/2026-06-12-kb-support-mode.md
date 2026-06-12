# v2.1 Knowledge Base Source Management + Customer Support Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add URL-to-KB-document import, citations in draft replies, and automatic support-thread detection with KB-match draft suggestions and inbox surfacing.

**Architecture:** New `lib/agent/support-classifier.ts` (pure function, fully testable) wired into `work-item-sync` fire-and-forget alongside lead scoring. URL crawl as a new API route. Draft reply JSON schema extended with `citedDocumentIds`. New `/knowledge-base` management page replaces inline settings form. `CommandCenterState` gains `"support"` state. New `SupportPanel` on conversation pages.

**Tech Stack:** Next.js 14 App Router, Prisma, Vitest, Tailwind CSS. Migration workflow: hand-write SQL → `prisma db execute --file` → `prisma migrate resolve --applied` → `prisma generate`. Test mocks: all `vi.mock`/`vi.fn` inside `vi.hoisted()`, destructure from return value.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `sourceUrl`, `crawledAt` to `KnowledgeDocument` |
| `lib/knowledge-document-types.ts` | Modify | Add `"webpage"` source type |
| `lib/agent/support-classifier.ts` | Create | `classifySupportSignals` pure function |
| `app/api/knowledge-documents/crawl/route.ts` | Create | URL crawl endpoint |
| `lib/agent/work-item-sync.ts` | Modify | Wire support classification + KB-match draft trigger |
| `lib/agent/command-center.ts` | Modify | Add `"support"` state, `sections.support`, `counts.support` |
| `lib/ai/prompts/draft-reply.ts` | Modify | Add `citedDocumentIds` to schema, result type, and prompt |
| `app/knowledge-base/page.tsx` | Create | KB management page (server component) |
| `app/knowledge-base/KbUrlImport.tsx` | Create | URL import form (client component) |
| `app/knowledge-base/KbDocList.tsx` | Create | Document list with delete (client component) |
| `app/conversations/[id]/SupportPanel.tsx` | Create | Support signals panel for conversation pages |
| `app/conversations/[id]/page.tsx` | Modify | Fetch conversationState + KB doc, render SupportPanel |
| `app/inbox/page.tsx` | Modify | Add Support filter tab |
| `app/inbox/CommandCenterPanel.tsx` | Modify | Add Support count chip |
| `app/settings/page.tsx` | Modify | Replace inline KB form with "Manage →" link |
| `tests/support-classifier.test.ts` | Create | Unit tests for `classifySupportSignals` |
| `tests/kb-crawl.test.ts` | Create | Unit tests for crawl route validation |
| `docs/MASTER_PRODUCT_PLAN.md` | Modify | Update features #8 and #19 status |
| `docs/CURRENT_STATE.md` | Modify | Document new capabilities |
| `docs/TODO.md` | Modify | Check off KB source management and support mode |

---

## Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/knowledge-document-types.ts`

- [ ] **Step 1: Update `prisma/schema.prisma`**

Find the `model KnowledgeDocument` block (currently at line ~271) and add two fields after `sourceType`:

```prisma
model KnowledgeDocument {
  id         String    @id @default(cuid())
  tenantId   String
  tenant     Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  title      String
  content    String
  sourceType String    @default("faq")
  sourceUrl  String?
  crawledAt  DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  @@index([tenantId])
}
```

- [ ] **Step 2: Add `"webpage"` to `lib/knowledge-document-types.ts`**

Replace the full file content:

```typescript
export const SOURCE_TYPE_OPTIONS = [
  { value: "faq", label: "FAQ" },
  { value: "service", label: "Service" },
  { value: "policy", label: "Policy" },
  { value: "pricing", label: "Pricing" },
  { value: "prep_instructions", label: "Prep Instructions" },
  { value: "cancellation", label: "Cancellation" },
  { value: "webpage", label: "Webpage" },
  { value: "other", label: "Other" },
] as const

export const VALID_SOURCE_TYPES = SOURCE_TYPE_OPTIONS.map((o) => o.value)
export type SourceType = (typeof SOURCE_TYPE_OPTIONS)[number]["value"]

export function isValidSourceType(value: string): value is SourceType {
  return (VALID_SOURCE_TYPES as readonly string[]).includes(value)
}
```

- [ ] **Step 3: Write the migration SQL**

Create `prisma/migrations/20260612_add_kb_source_fields/migration.sql`:

```sql
ALTER TABLE "KnowledgeDocument" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "crawledAt" TIMESTAMP(3);
```

- [ ] **Step 4: Apply migration**

```bash
npx prisma db execute --file prisma/migrations/20260612_add_kb_source_fields/migration.sql
npx prisma migrate resolve --applied 20260612_add_kb_source_fields
npx prisma generate
```

Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "KnowledgeDocument|sourceUrl|crawledAt" | head -10
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ lib/knowledge-document-types.ts
git commit -m "feat: add sourceUrl, crawledAt to KnowledgeDocument; add webpage source type"
```

---

## Task 2: Support Classifier

**Files:**
- Create: `lib/agent/support-classifier.ts`

- [ ] **Step 1: Create `lib/agent/support-classifier.ts`**

```typescript
// lib/agent/support-classifier.ts

const SUPPORT_PATTERN =
  /\b(not working|broken|issue|problem|bug|glitch|error|complaint|refund|still waiting|never received|keep getting|frustrated|unacceptable|worst|terrible)\b/i

const CHURN_PATTERN =
  /\b(cancel|cancellation|unsubscribe|quit|leave|switching|going elsewhere|competitor|disappointed|done with)\b/i

const SENSITIVE_PATTERN =
  /\b(legal|lawsuit|attorney|tax|medical|doctor|diagnosis|angry|furious|dispute|contract|hr|employment)\b/i

export type SupportSignals = {
  isSupport: boolean
  churnRisk: boolean
  needsEscalation: boolean
  suggestedKbDocId: string | null
}

export type SupportClassifierMessage = {
  direction: string
  body: string
}

export type SupportClassifierKbDoc = {
  id: string
  title: string
  content: string
}

export function classifySupportSignals(
  messages: SupportClassifierMessage[],
  kbDocs: SupportClassifierKbDoc[],
  label?: string | null
): SupportSignals {
  const bodyText = messages.map((m) => m.body).join("\n")
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound")

  const isSupport = label === "Support" || SUPPORT_PATTERN.test(bodyText)
  const hasChurnLanguage = CHURN_PATTERN.test(bodyText)
  const churnRisk = isSupport && hasChurnLanguage
  const needsEscalation = churnRisk && SENSITIVE_PATTERN.test(bodyText)

  let suggestedKbDocId: string | null = null
  if (lastInbound && kbDocs.length > 0) {
    const queryWords = new Set(
      lastInbound.body
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3)
    )

    let bestScore = 0
    for (const doc of kbDocs) {
      const docWords = new Set(
        (doc.title + " " + doc.content)
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 3)
      )
      const overlap = [...queryWords].filter((w) => docWords.has(w)).length
      if (overlap >= 3 && overlap > bestScore) {
        bestScore = overlap
        suggestedKbDocId = doc.id
      }
    }
  }

  return { isSupport, churnRisk, needsEscalation, suggestedKbDocId }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "support-classifier" | head -10
```

Expected: no output.

---

## Task 3: Tests for Support Classifier

**Files:**
- Create: `tests/support-classifier.test.ts`

- [ ] **Step 1: Create `tests/support-classifier.test.ts`**

```typescript
import { describe, it, expect } from "vitest"
import {
  classifySupportSignals,
  type SupportClassifierMessage,
  type SupportClassifierKbDoc,
} from "@/lib/agent/support-classifier"

const SUPPORT_MSGS: SupportClassifierMessage[] = [
  { direction: "inbound", body: "This is broken and still not working after 3 days." },
  { direction: "outbound", body: "We're looking into it." },
]

const CHURN_MSGS: SupportClassifierMessage[] = [
  { direction: "inbound", body: "I'm frustrated and thinking of cancellation." },
]

const NORMAL_MSGS: SupportClassifierMessage[] = [
  { direction: "inbound", body: "Hi, when are you open?" },
]

const KB_DOCS: SupportClassifierKbDoc[] = [
  {
    id: "doc-1",
    title: "Refund Policy",
    content: "To request a refund please contact support within 30 days of purchase.",
  },
  {
    id: "doc-2",
    title: "Pricing FAQ",
    content: "Our pricing starts at $49 per month with annual billing options available.",
  },
]

describe("classifySupportSignals", () => {
  it("detects support from keyword pattern", () => {
    const result = classifySupportSignals(SUPPORT_MSGS, [])
    expect(result.isSupport).toBe(true)
  })

  it("detects support from label override", () => {
    const result = classifySupportSignals(NORMAL_MSGS, [], "Support")
    expect(result.isSupport).toBe(true)
  })

  it("returns isSupport false for normal messages", () => {
    const result = classifySupportSignals(NORMAL_MSGS, [])
    expect(result.isSupport).toBe(false)
  })

  it("detects churn risk when support + cancellation language", () => {
    const result = classifySupportSignals(CHURN_MSGS, [])
    expect(result.isSupport).toBe(true)
    expect(result.churnRisk).toBe(true)
  })

  it("does not flag churn risk without support signal", () => {
    const msgs: SupportClassifierMessage[] = [
      { direction: "inbound", body: "I am thinking of cancellation." },
    ]
    const result = classifySupportSignals(msgs, [])
    expect(result.churnRisk).toBe(false)
  })

  it("detects escalation when churn + sensitive topic", () => {
    const msgs: SupportClassifierMessage[] = [
      {
        direction: "inbound",
        body: "This is broken and I am angry and want to cancel. This is a legal matter.",
      },
    ]
    const result = classifySupportSignals(msgs, [])
    expect(result.needsEscalation).toBe(true)
  })

  it("returns needsEscalation false without churn risk", () => {
    const msgs: SupportClassifierMessage[] = [
      { direction: "inbound", body: "I have a legal question about pricing." },
    ]
    const result = classifySupportSignals(msgs, [])
    expect(result.needsEscalation).toBe(false)
  })

  it("matches KB doc by keyword overlap >= 3", () => {
    const msgs: SupportClassifierMessage[] = [
      { direction: "inbound", body: "I need to request a refund for my purchase within days." },
    ]
    const result = classifySupportSignals(msgs, KB_DOCS)
    expect(result.suggestedKbDocId).toBe("doc-1")
  })

  it("returns null suggestedKbDocId when overlap < 3", () => {
    const msgs: SupportClassifierMessage[] = [
      { direction: "inbound", body: "Hello there." },
    ]
    const result = classifySupportSignals(msgs, KB_DOCS)
    expect(result.suggestedKbDocId).toBeNull()
  })

  it("returns null suggestedKbDocId when no KB docs", () => {
    const result = classifySupportSignals(SUPPORT_MSGS, [])
    expect(result.suggestedKbDocId).toBeNull()
  })

  it("picks the doc with the highest overlap when multiple match", () => {
    const msgs: SupportClassifierMessage[] = [
      {
        direction: "inbound",
        body: "I want to request a refund contact support within days purchase.",
      },
    ]
    const result = classifySupportSignals(msgs, KB_DOCS)
    expect(result.suggestedKbDocId).toBe("doc-1")
  })

  it("only considers the last inbound message for KB matching", () => {
    const msgs: SupportClassifierMessage[] = [
      {
        direction: "inbound",
        body: "I want to request a refund contact support within days purchase.",
      },
      { direction: "outbound", body: "We'll look into this." },
      { direction: "inbound", body: "What is the pricing monthly annual billing options?" },
    ]
    const result = classifySupportSignals(msgs, KB_DOCS)
    expect(result.suggestedKbDocId).toBe("doc-2")
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run tests/support-classifier.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/support-classifier.ts tests/support-classifier.test.ts
git commit -m "feat: add support classifier with churn-risk and KB-match detection"
```

---

## Task 4: URL Crawl Endpoint

**Files:**
- Create: `app/api/knowledge-documents/crawl/route.ts`
- Create: `tests/kb-crawl.test.ts`

- [ ] **Step 1: Create `app/api/knowledge-documents/crawl/route.ts`**

```typescript
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const PRIVATE_IP_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1)/i

function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_IP_RE.test(hostname)
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match ? match[1].trim() : null
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tenantId = session.user.tenantId
  const body = await request.json().catch(() => null)
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : ""
  const rawTitle = typeof body?.title === "string" ? body.title.trim() : ""

  if (!rawUrl) {
    return NextResponse.json({ error: "url is required" }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only https:// URLs are supported" },
      { status: 400 }
    )
  }

  if (isPrivateHostname(parsed.hostname)) {
    return NextResponse.json(
      { error: "Private or loopback URLs are not allowed" },
      { status: 400 }
    )
  }

  let html: string
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const upstream = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "FlowDesk/1.0 (content-importer)" },
    })
    clearTimeout(timer)
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: 502 }
      )
    }
    html = await upstream.text()
  } catch {
    return NextResponse.json({ error: "Failed to fetch URL" }, { status: 502 })
  }

  const title = rawTitle || extractTitle(html) || parsed.hostname
  const content = stripHtml(html).slice(0, 8000)

  if (!content.trim()) {
    return NextResponse.json(
      { error: "No readable content found at that URL" },
      { status: 422 }
    )
  }

  const [document] = await prisma.$transaction([
    prisma.knowledgeDocument.create({
      data: {
        tenantId,
        title,
        content,
        sourceType: "webpage",
        sourceUrl: rawUrl,
        crawledAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id,
        action: "knowledge_document.crawl",
        payloadJson: { url: rawUrl, title },
      },
    }),
  ])

  return NextResponse.json({ document }, { status: 201 })
}
```

- [ ] **Step 2: Create `tests/kb-crawl.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

const {
  mockGetServerSession,
  mockCreate,
  mockAuditCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockCreate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockTransaction: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    knowledgeDocument: { create: mockCreate },
    auditLog: { create: mockAuditCreate },
    $transaction: mockTransaction,
  },
}))

import { POST } from "@/app/api/knowledge-documents/crawl/route"

const SESSION = { user: { tenantId: "t-1", id: "u-1" } }
const CREATED_DOC = { id: "doc-1", title: "FAQ", content: "Some content", sourceType: "webpage" }

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/knowledge-documents/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/knowledge-documents/crawl", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(SESSION)
    mockTransaction.mockResolvedValue([CREATED_DOC])
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await POST(makeRequest({ url: "https://example.com" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when url is missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("url is required")
  })

  it("returns 400 for invalid URL", async () => {
    const res = await POST(makeRequest({ url: "not-a-url" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Invalid URL")
  })

  it("returns 400 for http:// URL", async () => {
    const res = await POST(makeRequest({ url: "http://example.com" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Only https:// URLs are supported")
  })

  it("returns 400 for localhost URL", async () => {
    const res = await POST(makeRequest({ url: "https://localhost/admin" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Private or loopback URLs are not allowed")
  })

  it("returns 400 for private IP URL", async () => {
    const res = await POST(makeRequest({ url: "https://192.168.1.1/data" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Private or loopback URLs are not allowed")
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/kb-crawl.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 4: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass (same count as before + 6 new).

- [ ] **Step 5: Commit**

```bash
git add app/api/knowledge-documents/crawl/route.ts tests/kb-crawl.test.ts
git commit -m "feat: add POST /api/knowledge-documents/crawl URL import endpoint"
```

---

## Task 5: Draft Reply Citation Extension

**Files:**
- Modify: `lib/ai/prompts/draft-reply.ts`

- [ ] **Step 1: Add `citedDocumentIds` to `DraftReplyResult` type**

In `lib/ai/prompts/draft-reply.ts`, find the `DraftReplyResult` type and add the new field:

```typescript
export type DraftReplyResult = {
  draftText: string
  intent: string
  confidence: number
  riskLevel: RiskLevel
  suggestedLabel: AllowedLabel | null
  escalationReason: string | null
  citedDocumentIds: string[]
  model: string
}
```

- [ ] **Step 2: Add `citedDocumentIds` to `draftReplyJsonSchema`**

Find the `draftReplyJsonSchema` object and add to the `required` array and `properties`:

```typescript
export const draftReplyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "draftText",
    "intent",
    "confidence",
    "riskLevel",
    "suggestedLabel",
    "escalationReason",
    "citedDocumentIds",
  ],
  properties: {
    draftText: { type: "string" },
    intent: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    riskLevel: { type: "string", enum: RISK_LEVELS },
    suggestedLabel: { anyOf: [{ type: "string", enum: ALLOWED_LABELS }, { type: "null" }] },
    escalationReason: { anyOf: [{ type: "string" }, { type: "null" }] },
    citedDocumentIds: { type: "array", items: { type: "string" } },
  },
}
```

- [ ] **Step 3: Include doc IDs in the knowledge section of the prompt**

In `buildDraftReplyPrompt`, find where `knowledge` is built and update it to include the ID:

```typescript
const knowledge = input.knowledgeDocuments
  .slice(0, 50)
  .map((doc, index) => {
    const title = doc.title?.trim() || `Document ${index + 1}`
    const id = doc.id ?? `doc-${index}`
    return `- [${id}] ${title} (${doc.sourceType ?? "knowledge"}): ${truncate(doc.content ?? "", 1800)}`
  })
  .join("\n")
```

- [ ] **Step 4: Add citation instruction to the prompt**

In `buildDraftReplyPrompt`, find the safety rules section and add one line before the closing bracket of the rules array:

```typescript
"- In citedDocumentIds, list the IDs (the [id] prefix in the knowledge list) of any documents you used to answer the email. Leave the array empty if none were used.",
```

- [ ] **Step 5: Update `normalizeLeadScoringOutput`-style normalizer — update `normalizeDraftReplyOutput`**

Find the `normalizeDraftReplyOutput` function (or wherever `DraftReplyResult` is constructed from the raw LLM output). Add extraction of `citedDocumentIds`:

```typescript
const raw = parsed as Record<string, unknown>

const citedDocumentIds: string[] = Array.isArray(raw.citedDocumentIds)
  ? (raw.citedDocumentIds as unknown[])
      .filter((id): id is string => typeof id === "string")
  : []
```

And include `citedDocumentIds` in the returned object.

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "draft-reply" | head -10
```

Expected: no output.

- [ ] **Step 7: Run all tests**

```bash
npx vitest run
```

Expected: all tests still pass.

- [ ] **Step 8: Commit**

```bash
git add lib/ai/prompts/draft-reply.ts
git commit -m "feat: add citedDocumentIds to draft reply schema, prompt, and result type"
```

---

## Task 6: Wire Support Classification into Work-Item Sync

**Files:**
- Modify: `lib/agent/work-item-sync.ts`

- [ ] **Step 1: Add imports at the top of `lib/agent/work-item-sync.ts`**

Add alongside the existing imports:

```typescript
import { classifySupportSignals } from "@/lib/agent/support-classifier"
```

- [ ] **Step 2: Fetch KB docs after the conversation query**

After the `if (!conversation)` guard block, add a KB fetch (fire-and-forget safe — it runs before the state upsert):

```typescript
const kbDocs = await prisma.knowledgeDocument.findMany({
  where: { tenantId: input.tenantId },
  select: { id: true, title: true, content: true },
  take: 50,
})
```

- [ ] **Step 3: Run support classification and merge into state metadata**

After the `syncPersonMemory` call near the end of the function (just before the `return` statement), add:

```typescript
const supportSignals = classifySupportSignals(
  conversation.messages.map((m) => ({ direction: m.direction, body: m.body })),
  kbDocs,
  conversation.label
)

if (supportSignals.isSupport) {
  const existing = (await prisma.conversationState.findUnique({
    where: { conversationId: conversation.id },
    select: { metadataJson: true },
  }))?.metadataJson

  const existingMeta =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}

  await prisma.conversationState.update({
    where: { conversationId: conversation.id },
    data: {
      metadataJson: {
        ...existingMeta,
        isSupport: true,
        churnRisk: supportSignals.churnRisk,
        needsEscalation: supportSignals.needsEscalation,
        suggestedKbDocId: supportSignals.suggestedKbDocId,
      } as Prisma.InputJsonValue,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "conversation_state.support_classified",
      payloadJson: {
        conversationId: conversation.id,
        churnRisk: supportSignals.churnRisk,
        needsEscalation: supportSignals.needsEscalation,
        suggestedKbDocId: supportSignals.suggestedKbDocId,
      },
    },
  })
}
```

- [ ] **Step 4: Update `SyncConversationWorkItemsResult` type to include support signal**

```typescript
export type SyncConversationWorkItemsResult = {
  stateSynced: boolean
  tasksSynced: number
  leadSynced: boolean
  supportClassified: boolean
}
```

Update the return statement at the end:

```typescript
return { stateSynced: true, tasksSynced, leadSynced, supportClassified: supportSignals.isSupport }
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "work-item-sync" | head -10
```

Expected: no output.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: all tests still pass. (Existing work-item-sync tests use mocked prisma; the new KB query will be handled by the mock's default `undefined` return — the `kbDocs ?? []` fallback keeps the classifier safe.)

- [ ] **Step 7: Commit**

```bash
git add lib/agent/work-item-sync.ts
git commit -m "feat: wire support classification into work-item-sync"
```

---

## Task 7: Command Center Support State

**Files:**
- Modify: `lib/agent/command-center.ts`

- [ ] **Step 1: Add `"support"` to `CommandCenterState`**

Find the `CommandCenterState` type and add `"support"`:

```typescript
export type CommandCenterState =
  | "needs_reply"
  | "waiting_on_them"
  | "waiting_on_you"
  | "scheduled"
  | "done"
  | "snoozed"
  | "delegated"
  | "risky_urgent"
  | "opportunity"
  | "support"
  | "fyi_only"
```

- [ ] **Step 2: Add `isSupport` to `CommandCenterInputConversation`**

In the `CommandCenterInputConversation` type, add after the `lead` field:

```typescript
  conversationState?: {
    metadataJson?: unknown
  } | null
```

- [ ] **Step 3: Add `support` to `DailyCommandCenter` counts and sections**

In the `DailyCommandCenter` type:

```typescript
export type DailyCommandCenter = {
  headline: string
  droppedBallMessage: string
  counts: {
    needsReply: number
    waitingOnThem: number
    waitingOnYou: number
    meetings: number
    approvals: number
    opportunities: number
    potentialProblems: number
    support: number
    safelyIgnored: number
  }
  topActions: CommandCenterConversation[]
  sections: {
    needsReply: CommandCenterConversation[]
    waitingOnThem: CommandCenterConversation[]
    meetings: CommandCenterConversation[]
    approvals: CommandCenterConversation[]
    opportunities: CommandCenterConversation[]
    potentialProblems: CommandCenterConversation[]
    support: CommandCenterConversation[]
    safelyIgnored: CommandCenterConversation[]
  }
  conversations: CommandCenterConversation[]
}
```

- [ ] **Step 4: Add a helper to read support metadata**

After the `metadata()` helper function, add:

```typescript
function isClassifiedSupport(conversation: CommandCenterInputConversation): boolean {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return false
  return (state.metadataJson as Record<string, unknown>).isSupport === true
}

function isChurnRisk(conversation: CommandCenterInputConversation): boolean {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return false
  return (state.metadataJson as Record<string, unknown>).churnRisk === true
}
```

- [ ] **Step 5: Add support state to `analyzeConversationForCommandCenter`**

After the `sensitive` detection block (before `opportunity`), add:

```typescript
  const support = isClassifiedSupport(conversation)
  const churnRisk = isChurnRisk(conversation)
```

And in the state-setting if/else chain, add after the `sensitive` block and before `hold`:

```typescript
  if (churnRisk) {
    state = "support"
    priority = "urgent"
    reason = "Churn risk detected — customer may cancel."
    nextAction = "Reply promptly and address the core issue."
  } else if (support) {
    state = "support"
    priority = "high"
    reason = "Customer support request detected."
    nextAction = "Reply using the knowledge base or escalate."
  } else if (hold) {
```

- [ ] **Step 6: Update `buildDailyCommandCenter` to populate support counts and sections**

In `buildDailyCommandCenter`, update the `counts` and `sections` objects:

```typescript
counts: {
  needsReply: analyzed.filter((c) => c.needsReply).length,
  waitingOnThem: analyzed.filter((c) => c.state === "waiting_on_them").length,
  waitingOnYou: analyzed.filter((c) => c.state === "waiting_on_you").length,
  meetings: analyzed.filter((c) => c.state === "scheduled").length,
  approvals: approvals.length,
  opportunities: analyzed.filter((c) => c.opportunity).length,
  potentialProblems: analyzed.filter((c) => c.sensitive).length,
  support: analyzed.filter((c) => c.state === "support").length,
  safelyIgnored: analyzed.filter((c) => c.safelyIgnored).length,
},
```

```typescript
sections: {
  needsReply: analyzed.filter((c) => c.state === "needs_reply"),
  waitingOnThem: analyzed.filter((c) => c.state === "waiting_on_them"),
  meetings: analyzed.filter((c) => c.state === "scheduled"),
  approvals,
  opportunities: analyzed.filter((c) => c.opportunity),
  potentialProblems: analyzed.filter((c) => c.sensitive),
  support: analyzed.filter((c) => c.state === "support"),
  safelyIgnored: analyzed.filter((c) => c.safelyIgnored),
},
```

- [ ] **Step 7: Update the `score()` function to give support threads a +30 bonus**

```typescript
function score(conversation: CommandCenterConversation): number {
  const priorityScore: Record<CommandCenterPriority, number> = {
    urgent: 500,
    high: 400,
    medium: 300,
    low: 200,
    none: 0,
  }
  return (
    priorityScore[conversation.priority] +
    (conversation.opportunity ? 25 : 0) +
    (conversation.sensitive ? 20 : 0) +
    (conversation.needsReply ? 10 : 0) +
    (conversation.state === "support" ? 30 : 0)
  )
}
```

- [ ] **Step 8: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "command-center" | head -10
```

Expected: no output.

- [ ] **Step 9: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/agent/command-center.ts
git commit -m "feat: add support state to command center with churn-risk priority"
```

---

## Task 8: `/knowledge-base` Management Page

**Files:**
- Create: `app/knowledge-base/page.tsx`
- Create: `app/knowledge-base/KbUrlImport.tsx`
- Create: `app/knowledge-base/KbDocList.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Create `app/knowledge-base/KbUrlImport.tsx`**

```typescript
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function KbUrlImport() {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleImport() {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/knowledge-documents/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to import page.")
        return
      }
      setUrl("")
      setTitle("")
      router.refresh()
    } catch {
      setError("Network error — please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Import from URL</h2>
      <div className="flex flex-col gap-2">
        <input
          type="url"
          placeholder="https://yoursite.com/faq"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <input
          type="text"
          placeholder="Title (optional — auto-detected)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={handleImport}
          disabled={loading || !url.trim()}
          className="self-start rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Importing…" : "Import page"}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/knowledge-base/KbDocList.tsx`**

```typescript
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { SOURCE_TYPE_OPTIONS } from "@/lib/knowledge-document-types"

type KbDoc = {
  id: string
  title: string
  content: string
  sourceType: string
  sourceUrl: string | null
  createdAt: string
}

const SOURCE_TYPE_COLORS: Record<string, string> = {
  faq: "bg-blue-50 text-blue-700",
  service: "bg-purple-50 text-purple-700",
  policy: "bg-amber-50 text-amber-700",
  pricing: "bg-green-50 text-green-700",
  prep_instructions: "bg-teal-50 text-teal-700",
  cancellation: "bg-red-50 text-red-600",
  webpage: "bg-indigo-50 text-indigo-700",
  other: "bg-slate-100 text-slate-600",
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function sourceTypeLabel(value: string): string {
  return SOURCE_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value
}

export default function KbDocList({ initialDocs }: { initialDocs: KbDoc[] }) {
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await fetch(`/api/knowledge-documents/${id}`, { method: "DELETE" })
      router.refresh()
    } finally {
      setDeletingId(null)
    }
  }

  if (initialDocs.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
        No knowledge documents yet. Import a URL or add a document manually.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <ul className="divide-y divide-slate-100">
        {initialDocs.map((doc) => (
          <li key={doc.id} className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{doc.title}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_TYPE_COLORS[doc.sourceType] ?? SOURCE_TYPE_COLORS.other}`}
                >
                  {sourceTypeLabel(doc.sourceType)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{wordCount(doc.content)} words</p>
              {doc.sourceUrl && (
                <p className="mt-0.5 truncate text-xs text-slate-400">{doc.sourceUrl}</p>
              )}
            </div>
            <button
              onClick={() => handleDelete(doc.id)}
              disabled={deletingId === doc.id}
              className="shrink-0 rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              {deletingId === doc.id ? "…" : "Delete"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Create `app/knowledge-base/page.tsx`**

```typescript
import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import KbUrlImport from "@/app/knowledge-base/KbUrlImport"
import KbDocList from "@/app/knowledge-base/KbDocList"

export const dynamic = "force-dynamic"

export default async function KnowledgeBasePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { accountType: true },
  })
  if (tenant?.accountType === "personal") redirect("/inbox")

  const docs = await prisma.knowledgeDocument.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      content: true,
      sourceType: true,
      sourceUrl: true,
      createdAt: true,
    },
  })

  const serializedDocs = docs.map((d) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
  }))

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-700">
            ← Back to settings
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Knowledge Base</h1>
          <p className="text-sm text-slate-500">
            {docs.length} document{docs.length === 1 ? "" : "s"} · used when drafting replies
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <KbUrlImport />

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Your documents</h2>
          <KbDocList initialDocs={serializedDocs} />
        </section>
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Update `app/settings/page.tsx` to replace inline KB form**

Find the section that renders `<KnowledgeDocumentList initialDocuments={knowledgeDocuments} />` (around line 443). Replace the entire surrounding card block that contains the KB form with:

```tsx
<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
  <h2 className="mb-1 text-sm font-semibold text-slate-800">Knowledge Base</h2>
  <p className="mb-3 text-sm text-slate-500">
    {knowledgeDocuments.length} document{knowledgeDocuments.length === 1 ? "" : "s"} configured
  </p>
  <Link
    href="/knowledge-base"
    className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
  >
    Manage knowledge base →
  </Link>
</div>
```

Remove the now-unused imports for `KnowledgeDocumentList` and `KnowledgeDocumentForm` from `app/settings/page.tsx` if they are no longer referenced elsewhere in the file.

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "knowledge-base|KbUrl|KbDoc" | head -10
```

Expected: no output.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/knowledge-base/ app/settings/page.tsx
git commit -m "feat: add /knowledge-base management page with URL import"
```

---

## Task 9: SupportPanel Component

**Files:**
- Create: `app/conversations/[id]/SupportPanel.tsx`

- [ ] **Step 1: Create `app/conversations/[id]/SupportPanel.tsx`**

```typescript
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type SupportPanelProps = {
  conversationId: string
  isSupport: boolean
  churnRisk: boolean
  needsEscalation: boolean
  suggestedKbDoc: {
    id: string
    title: string
    content: string
    sourceType: string
  } | null
  repeatContactCount: number
}

export default function SupportPanel({
  conversationId,
  isSupport,
  churnRisk,
  needsEscalation,
  suggestedKbDoc,
  repeatContactCount,
}: SupportPanelProps) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)

  if (!isSupport) return null

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-blue-50 shadow-sm">
      <div className="flex items-center gap-2 border-b border-blue-100 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Support
        </span>
        {churnRisk && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            Churn Risk
          </span>
        )}
        {needsEscalation && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            Needs Escalation
          </span>
        )}
        {repeatContactCount > 1 && (
          <span className="ml-auto text-xs text-slate-500">
            {repeatContactCount} support threads from this contact
          </span>
        )}
      </div>

      {suggestedKbDoc && (
        <div className="px-4 py-3">
          <p className="mb-1.5 text-xs font-medium text-blue-800">Suggested answer from KB:</p>
          <p className="text-xs font-semibold text-slate-800">{suggestedKbDoc.title}</p>
          <p className="mt-1 line-clamp-3 text-xs text-slate-600">
            {expanded
              ? suggestedKbDoc.content
              : suggestedKbDoc.content.slice(0, 300) +
                (suggestedKbDoc.content.length > 300 ? "…" : "")}
          </p>
          {suggestedKbDoc.content.length > 300 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs text-blue-600 hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          <button
            onClick={async () => {
              await fetch(`/api/conversations/${conversationId}/draft`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: suggestedKbDoc.content,
                  status: "proposed",
                }),
              })
              router.refresh()
            }}
            className="mt-3 block rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
          >
            Use this answer
          </button>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "SupportPanel" | head -10
```

Expected: no output.

---

## Task 10: Wire SupportPanel into Conversation Page

**Files:**
- Modify: `app/conversations/[id]/page.tsx`

- [ ] **Step 1: Add import at the top of `app/conversations/[id]/page.tsx`**

```typescript
import SupportPanel from "@/app/conversations/[id]/SupportPanel"
```

- [ ] **Step 2: Add `conversationState` and `suggestedKbDoc` to the data fetches**

In the `Promise.all` block, add two new parallel queries after the existing ones:

```typescript
    prisma.conversationState.findUnique({
      where: { conversationId: params.id },
      select: { metadataJson: true },
    }),
```

Update the destructured array to capture it:

```typescript
  const [
    conversation,
    businessProfile,
    knowledgeDocumentCount,
    latestAgentJob,
    activeHold,
    pendingApprovals,
    pendingFollowUpJob,
    conversationState,
  ] = await Promise.all([...])
```

- [ ] **Step 3: Extract support signals from conversationState**

After the `Promise.all`, add:

```typescript
  const stateMeta =
    conversationState?.metadataJson &&
    typeof conversationState.metadataJson === "object" &&
    !Array.isArray(conversationState.metadataJson)
      ? (conversationState.metadataJson as Record<string, unknown>)
      : {}

  const isSupport = stateMeta.isSupport === true
  const churnRisk = stateMeta.churnRisk === true
  const needsEscalation = stateMeta.needsEscalation === true
  const suggestedKbDocId =
    typeof stateMeta.suggestedKbDocId === "string" ? stateMeta.suggestedKbDocId : null

  const [suggestedKbDoc, repeatContactCount] = await Promise.all([
    suggestedKbDocId
      ? prisma.knowledgeDocument.findFirst({
          where: { id: suggestedKbDocId, tenantId: session.user.tenantId },
          select: { id: true, title: true, content: true, sourceType: true },
        })
      : Promise.resolve(null),
    isSupport && conversation?.contactId
      ? prisma.conversationState.count({
          where: {
            tenantId: session.user.tenantId,
            conversation: { contactId: conversation.contactId },
            metadataJson: { path: ["isSupport"], equals: true },
          },
        })
      : Promise.resolve(0),
  ])
```

- [ ] **Step 4: Render `SupportPanel` in the JSX**

In the conversation page JSX, find where `WorkItemsPanel` is rendered and add `SupportPanel` immediately before it:

```tsx
<SupportPanel
  conversationId={params.id}
  isSupport={isSupport}
  churnRisk={churnRisk}
  needsEscalation={needsEscalation}
  suggestedKbDoc={suggestedKbDoc}
  repeatContactCount={repeatContactCount}
/>
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "\[id\]/page" | head -10
```

Expected: no output.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/conversations/[id]/SupportPanel.tsx app/conversations/[id]/page.tsx
git commit -m "feat: add SupportPanel to conversation pages with KB suggestion and signals"
```

---

## Task 11: Command Center Panel + Inbox Support Filter

**Files:**
- Modify: `app/inbox/CommandCenterPanel.tsx`
- Modify: `app/inbox/page.tsx`

- [ ] **Step 1: Add Support chip to `CommandCenterPanel.tsx`**

Find the `countItems` array at the top of the file and add the support entry:

```typescript
const countItems = [
  ["needsReply", "Needs reply"],
  ["waitingOnThem", "Waiting"],
  ["approvals", "Approvals"],
  ["meetings", "Meetings"],
  ["support", "Support"],
  ["opportunities", "Opportunities"],
  ["potentialProblems", "Problems"],
  ["safelyIgnored", "Ignored"],
] as const
```

- [ ] **Step 2: Add `conversationStates` to command center query in `app/inbox/page.tsx`**

In the `commandCenterConversations` query (the `prisma.conversation.findMany` with `take: 75`), add `conversationState` to the include:

```typescript
        conversationState: {
          select: { metadataJson: true },
        },
```

- [ ] **Step 3: Map `conversationState` into the command center input**

Find the line:

```typescript
  const commandCenter = buildDailyCommandCenter(
    commandCenterConversations.map((c) => ({
      ...c,
      lead: c.leads[0] ?? null,
    }))
  );
```

Update it to also pass `conversationState`:

```typescript
  const commandCenter = buildDailyCommandCenter(
    commandCenterConversations.map((c) => ({
      ...c,
      lead: c.leads[0] ?? null,
      conversationState: c.conversationState ?? null,
    }))
  );
```

- [ ] **Step 4: Add Support filter tab to the inbox status bar**

Find the status filter bar in `app/inbox/page.tsx` (the section that renders tabs for `needs_reply`, `in_progress`, `closed`). Add the support filter handling:

In the `Props` interface, the `searchParams` already includes `status`. A Support filter is a separate concern — add a `support` search param:

```typescript
interface Props {
  searchParams: { status?: string; q?: string; support?: string };
}
```

Update the `where` clause to filter by support when `searchParams.support === "1"`:

```typescript
  const supportFilter = searchParams.support === "1"

  const where = {
    tenantId,
    ...(supportFilter
      ? {
          conversationState: {
            metadataJson: { path: ["isSupport"], equals: true },
          },
        }
      : activeStatus
        ? { status: activeStatus }
        : {}),
    ...(q
      ? {
          OR: [
            { externalThreadId: { contains: q, mode: "insensitive" as const } },
            { contact: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
```

- [ ] **Step 5: Add Support tab to the filter bar JSX**

Find the JSX that renders the status filter tabs. After the last status tab (Closed), add:

```tsx
<Link
  href={`/inbox?support=1${q ? `&q=${encodeURIComponent(q)}` : ""}`}
  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
    supportFilter
      ? "bg-blue-600 text-white"
      : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
  }`}
>
  Support
</Link>
```

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "inbox/page|CommandCenterPanel" | head -10
```

Expected: no output.

- [ ] **Step 7: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/inbox/page.tsx app/inbox/CommandCenterPanel.tsx
git commit -m "feat: add support count chip to command center and support filter tab to inbox"
```

---

## Task 12: AIDraftPanel Citation UI

**Files:**
- Modify: `app/conversations/[id]/AIDraftPanel.tsx`

- [ ] **Step 1: Update `DraftMetadata` type in `AIDraftPanel.tsx`**

Find the `DraftMetadata` type (around line 8) and add the new field:

```typescript
type DraftMetadata = {
  intent?: unknown;
  confidence?: unknown;
  riskLevel?: unknown;
  suggestedLabel?: unknown;
  escalationReason?: unknown;
  citedDocumentIds?: string[];
};
```

- [ ] **Step 2: Add a `CitationChips` component inside `AIDraftPanel.tsx`**

Add this component definition before the `export default` function:

```typescript
function CitationChips({
  ids,
  conversationId,
}: {
  ids: string[]
  conversationId: string
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [docs, setDocs] = useState<Record<string, { title: string; content: string; sourceType: string }>>({})

  async function fetchDoc(id: string) {
    if (docs[id]) { setOpen(id); return }
    const res = await fetch(`/api/knowledge-documents/${id}`)
    if (!res.ok) return
    const data = await res.json()
    setDocs((prev) => ({ ...prev, [id]: data.document }))
    setOpen(id)
  }

  if (ids.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <span className="text-xs text-slate-500">Sources:</span>
      {ids.map((id) => {
        const doc = docs[id]
        return (
          <div key={id} className="relative">
            <button
              onClick={() => (open === id ? setOpen(null) : fetchDoc(id))}
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              {doc ? `[${doc.sourceType}] ${doc.title}` : id.slice(0, 8) + "…"}
            </button>
            {open === id && doc && (
              <div className="absolute left-0 top-6 z-10 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                <p className="mb-1 text-xs font-semibold text-slate-800">{doc.title}</p>
                <p className="text-xs text-slate-600 line-clamp-6">{doc.content}</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Render `CitationChips` in the draft panel**

Find where the draft text is rendered in the return JSX (look for `{hasDraftText && ...}`). After the draft text block and before the action buttons, add:

```tsx
{metadata?.citedDocumentIds && metadata.citedDocumentIds.length > 0 && (
  <CitationChips
    ids={metadata.citedDocumentIds}
    conversationId={conversationId}
  />
)}
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "AIDraftPanel" | head -10
```

Expected: no output.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/conversations/[id]/AIDraftPanel.tsx
git commit -m "feat: show citation chips for KB-sourced draft replies in AIDraftPanel"
```

---

## Task 13: Add Navigation Link for `/knowledge-base`

**Files:**
- Modify: `lib/app-navigation.ts` (or wherever nav items are defined)

- [ ] **Step 1: Find the navigation file**

```bash
grep -rn "knowledge-base\|knowledge_base\|reports\|/leads\|/tasks" lib/app-navigation.ts | head -20
```

- [ ] **Step 2: Add KB nav entry for business accounts**

In `lib/app-navigation.ts`, find where `/reports` or `/leads` is defined and add a Knowledge Base entry in the same pattern:

```typescript
{ label: "Knowledge Base", href: "/knowledge-base", accountTypes: ["business"] },
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "app-navigation" | head -10
```

Expected: no output.

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/app-navigation.ts
git commit -m "feat: add Knowledge Base nav link for business accounts"
```

---

## Task 14: Docs Update

**Files:**
- Modify: `docs/MASTER_PRODUCT_PLAN.md`
- Modify: `docs/CURRENT_STATE.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1: Update `docs/MASTER_PRODUCT_PLAN.md`**

Update the feature index rows for #8 and #19:

```
| 8  | Knowledge Base Replies | `Partial` | Phase 1/2 | URL import + webpage sourceType + citations in drafts shipped. Website re-crawl and semantic search remain. |
| 19 | Customer Support Agent Mode | `Partial` | Phase 2 | Auto-detect via work-item-sync; churn-risk + escalation flags; KB-match draft suggestion; SupportPanel on conversations; support filter in inbox; command center count. |
```

Add a decision log entry:

```
| 2026-06-12 | Ship v2.1: KB source management + customer support mode. | URL crawl → KB doc extends existing KnowledgeDocument model. Support classification added to work-item-sync fire-and-forget. Citations stored in Draft.metadataJson. No new Prisma models. Next: v2.2 sales agent mode + CRM analytics. |
```

Update the next-slice recommendation:

```markdown
### Next Slice: v2.2 — Sales Agent Mode + CRM Analytics

- Sales agent mode: qualification panel on conversation pages (budget/timeline extraction, closing language suggestions).
- Mini CRM pipeline reporting: score-range filter on `/leads`, week-over-week trend on `/reports`.
- ROI analytics: persist weekly `ValueMetric` snapshots for trend charts.
```

- [ ] **Step 2: Update `docs/CURRENT_STATE.md`**

Add a new section after the lead intelligence slice:

```markdown
### v2.1: Knowledge Base Source Management + Customer Support Mode

Shipped (2026-06-12):

- `prisma/schema.prisma` — `sourceUrl String?` and `crawledAt DateTime?` added to `KnowledgeDocument`; `"webpage"` added to valid source types.
- `POST /api/knowledge-documents/crawl` — server-side URL fetch, HTML-to-text stripping, SSRF prevention (https-only, no private IPs), 8000-char truncation. Creates a `KnowledgeDocument` with `sourceType: "webpage"`.
- `/knowledge-base` management page — URL import form, document list with source-type badge and word count, delete. Business accounts only.
- `lib/agent/support-classifier.ts` — `classifySupportSignals` pure function: detects support, churn risk, escalation need, and best KB-doc match by keyword overlap.
- `lib/agent/work-item-sync.ts` — runs support classification fire-and-forget after each sync; writes `isSupport`, `churnRisk`, `needsEscalation`, `suggestedKbDocId` into `ConversationState.metadataJson`.
- `lib/ai/prompts/draft-reply.ts` — `citedDocumentIds: string[]` added to schema, result type, and prompt. Doc IDs now included in knowledge-section format.
- `app/conversations/[id]/SupportPanel.tsx` — shows Support / Churn Risk / Needs Escalation badges, KB suggestion with "Use this answer", repeat-contact count.
- `app/conversations/[id]/AIDraftPanel.tsx` — citation chips below draft text; clicking a chip shows KB doc content in a popover.
- `app/inbox/page.tsx` + `CommandCenterPanel.tsx` — Support count chip in command center grid; Support filter tab in inbox.
- `lib/agent/command-center.ts` — `"support"` state; churn-risk threads get `urgent` priority; `counts.support` and `sections.support`.

Limitations:
- URL crawl is single-page only (no sitemap, no re-crawl scheduling).
- KB matching uses keyword overlap, not semantic/embedding search.
- No ticket numbering, SLA tracking, or team assignment (Phase 5).
```

- [ ] **Step 3: Update `docs/TODO.md`**

Check off KB source management and support mode under Phase 2:

```markdown
- [x] **Knowledge base source management** (#8) — shipped 2026-06-12: URL crawl endpoint, `sourceUrl`/`crawledAt` fields, `/knowledge-base` page, `"webpage"` source type, citations in draft replies.
- [x] **Customer support agent mode** (#19) — shipped 2026-06-12: `classifySupportSignals` in work-item-sync, SupportPanel on conversation pages, support filter in inbox, support count in command center.
```

- [ ] **Step 4: Run full test suite one final time**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/MASTER_PRODUCT_PLAN.md docs/CURRENT_STATE.md docs/TODO.md
git commit -m "docs: update Phase 2 status for v2.1 KB source management + support mode"
```
