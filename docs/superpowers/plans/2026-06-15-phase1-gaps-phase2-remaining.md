# Phase 1 Gaps + Phase 2 Remaining — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 9 remaining items from `docs/TODO.md` to `main`: richer sensitive detection + draft highlights, attention-category inbox filters + correction UI, command-center bills/deadline signals, trust UX (why + undo), per-category autopilot confidence thresholds, manual task creation, safely-ignored bulk archive, person-memory editing + LLM extraction upgrade, and local-business concierge templates. All commits go to `main` directly. One PR is created at the end.

**Architecture:** Pure extensions to existing `lib/agent/`, `lib/ai/prompts/`, `app/api/`, and `app/` components. One Prisma schema addition (`categoryThresholdsJson Json?` on `AutopilotSetting`). No new npm packages. LLM calls follow the existing `generateDraftReply` structured-output pattern. Tests use Vitest with `vi.hoisted()` mocks per the established codebase pattern.

**Tech Stack:** Next.js 14 App Router, Prisma 5, PostgreSQL, OpenAI SDK, Vitest, Tailwind CSS

**Migration workflow (no shadow DB):**
```bash
prisma db execute --file prisma/migrations/<name>/migration.sql --schema prisma/schema.prisma
prisma migrate resolve --applied <name>
prisma generate
```

---

## File Map

### New Files
- `app/api/conversations/[id]/attention/route.ts` — PATCH to override attentionCategory in ConversationState
- `app/api/conversations/bulk-close/route.ts` — POST to bulk-close FYI/quiet conversations
- `app/api/tasks/route.ts` — POST to manually create an InboxTask
- `app/api/person-memory/[contactId]/route.ts` — PATCH to update PersonMemory fields
- `app/api/settings/seed-templates/route.ts` — POST to seed concierge templates for tenant
- `app/api/audit/[id]/undo/route.ts` — POST to undo reversible audit actions
- `app/conversations/[id]/ManualTaskForm.tsx` — client component: inline "Add task" form
- `app/conversations/[id]/PersonMemoryEditPanel.tsx` — client component: edit form for PersonMemory fields
- `lib/agent/concierge-templates.ts` — default template list + `seedConciergeTemplates(tenantId)`
- `lib/ai/prompts/person-memory-extract.ts` — LLM prompt + JSON schema for structured memory extraction
- `prisma/migrations/20260615000000_add_category_thresholds/migration.sql`
- `tests/sensitive-classifier.test.ts`
- `tests/attention-correction.test.ts`
- `tests/bulk-close.test.ts`
- `tests/manual-task.test.ts`
- `tests/person-memory-edit.test.ts`
- `tests/concierge-templates.test.ts`

### Modified Files
- `prisma/schema.prisma` — add `categoryThresholdsJson Json?` to `AutopilotSetting`
- `lib/agent/risk-radar.ts` — extend `SENSITIVE_PATTERN`; export `detectSensitiveMatches(text): {phrase: string; category: string}[]`
- `lib/agent/autopilot.ts` — per-category threshold check in `checkAutopilotEligibility`
- `lib/agent/person-memory.ts` — add `syncPersonMemoryWithLLM(tenantId, contactId)`
- `lib/agent/command-center.ts` — add `buildBillsSection` helper; include `bills` in `DailyCommandCenter`
- `lib/ai/prompts/draft-reply.ts` — add `sensitiveMatches` array to result schema
- `app/api/conversations/[id]/draft/suggest/route.ts` — call `detectSensitiveMatches`, store in draft metadata
- `app/api/autopilot-settings/route.ts` — accept `categoryThresholds` in PATCH body
- `app/conversations/[id]/AIDraftPanel.tsx` — show sensitive match warning chips when `metadataJson.sensitiveMatches` present
- `app/conversations/[id]/WorkItemsPanel.tsx` — add "Add task" button that reveals `ManualTaskForm`
- `app/conversations/[id]/page.tsx` — include `PersonMemoryEditPanel`, pass contactId; wire `ManualTaskForm` conversationId
- `app/inbox/page.tsx` — add `?attention=<category>` filter support + bulk-close button on home view
- `app/audit/page.tsx` — add "Why" column reading `payloadJson.reason`; add undo button for reversible actions
- `app/settings/page.tsx` — add concierge template seeder section + pass `categoryThresholds` to `AutopilotSettingsForm`
- `app/settings/AutopilotSettingsForm.tsx` — add per-category threshold inputs
- `docs/TODO.md` — check off shipped items
- `docs/CURRENT_STATE.md` — update implemented foundations

---

## Task 1: Richer Sensitive Detection

**Files:**
- Modify: `lib/agent/risk-radar.ts`
- Create: `tests/sensitive-classifier.test.ts`

- [ ] **Step 1: Write failing tests for `detectSensitiveMatches`**

```typescript
// tests/sensitive-classifier.test.ts
import { describe, it, expect } from "vitest"
import { detectSensitiveMatches } from "@/lib/agent/risk-radar"

describe("detectSensitiveMatches", () => {
  it("detects legal language", () => {
    const result = detectSensitiveMatches("Please review the subpoena and consult your attorney.")
    expect(result.some((m) => m.category === "legal")).toBe(true)
    expect(result.some((m) => m.phrase.toLowerCase().includes("subpoena"))).toBe(true)
  })

  it("detects immigration language", () => {
    const result = detectSensitiveMatches("My green card application is at USCIS.")
    expect(result.some((m) => m.category === "immigration")).toBe(true)
  })

  it("detects tax language", () => {
    const result = detectSensitiveMatches("The IRS sent a tax audit notice.")
    expect(result.some((m) => m.category === "tax")).toBe(true)
  })

  it("detects medical language", () => {
    const result = detectSensitiveMatches("The diagnosis came back from the doctor.")
    expect(result.some((m) => m.category === "medical")).toBe(true)
  })

  it("detects HR language", () => {
    const result = detectSensitiveMatches("HR sent a termination notice about my employment.")
    expect(result.some((m) => m.category === "hr")).toBe(true)
  })

  it("detects emotional language", () => {
    const result = detectSensitiveMatches("We are going through a divorce and need help with custody.")
    expect(result.some((m) => m.category === "emotional")).toBe(true)
  })

  it("detects financial/dispute language", () => {
    const result = detectSensitiveMatches("This invoice is past due and we may go to collections.")
    expect(result.some((m) => m.category === "financial")).toBe(true)
  })

  it("returns empty array for non-sensitive text", () => {
    const result = detectSensitiveMatches("Thanks for scheduling the meeting for Tuesday!")
    expect(result).toHaveLength(0)
  })

  it("deduplicates identical phrases", () => {
    const result = detectSensitiveMatches("lawsuit lawsuit lawsuit")
    const phrases = result.map((m) => m.phrase)
    expect(new Set(phrases).size).toBe(phrases.length)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/sensitive-classifier.test.ts
```
Expected: FAIL — `detectSensitiveMatches is not a function`

- [ ] **Step 3: Extend `lib/agent/risk-radar.ts` with richer patterns and `detectSensitiveMatches`**

Add the following after the existing `SENSITIVE_PATTERN` constant and replace it:

```typescript
// Replace the existing SENSITIVE_PATTERN with these category-specific patterns:
const SENSITIVE_CATEGORIES: Array<{ category: string; pattern: RegExp }> = [
  {
    category: "legal",
    pattern:
      /\b(legal|lawsuit|sue|suing|attorney|lawyer|litigation|subpoena|deposition|settlement|court|arbitration|breach of contract|cease and desist|liability|indemnif|injunction)\b/i,
  },
  {
    category: "immigration",
    pattern:
      /\b(immigration|visa|green card|uscis|i-140|i-485|i-864|deportation|asylum|refugee|work permit|residency|naturalization|undocumented)\b/i,
  },
  {
    category: "tax",
    pattern:
      /\b(irs|tax (return|audit|lien|levy|debt|evasion)|w-2|1099|owing taxes|back taxes|tax penalty|tax fraud|owe the irs|accountant letter)\b/i,
  },
  {
    category: "medical",
    pattern:
      /\b(diagnosis|medical (condition|record|bill|claim)|doctor'?s (note|order|referral)|cancer|surgery|prescription|hipaa|insurance claim|disability claim|mental health (treatment|diagnosis))\b/i,
  },
  {
    category: "hr",
    pattern:
      /\b(human resources|hr department|termination|fired|laid off|layoff|wrongful (termination|dismissal)|discrimination|workplace harassment|hostile work environment|performance improvement plan|pip)\b/i,
  },
  {
    category: "emotional",
    pattern:
      /\b(divorce|separation|custody|restraining order|domestic (violence|abuse)|grief|bereavement|suicide|self.harm|mental health crisis|breakdown|estranged)\b/i,
  },
  {
    category: "financial",
    pattern:
      /\b(collections?|past due|overdue|debt collector|charged off|repossession|foreclosure|bankruptcy|wage garnishment|refund dispute|chargeback|fraud claim)\b/i,
  },
]

// Keep original SENSITIVE_PATTERN for backward compatibility with existing buildRiskRadar logic
const SENSITIVE_PATTERN =
  /\b(legal|lawsuit|attorney|immigration|tax|medical|doctor|diagnosis|hr|employment|refund|dispute|contract|collections?|divorce|breakup|angry|furious|harassment|liability|subpoena|irs|termination|custody|bankruptcy)\b/i

export type SensitiveMatch = { phrase: string; category: string }

export function detectSensitiveMatches(text: string): SensitiveMatch[] {
  const seen = new Set<string>()
  const results: SensitiveMatch[] = []

  for (const { category, pattern } of SENSITIVE_CATEGORIES) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g")
    const matches = text.matchAll(globalPattern)
    for (const match of matches) {
      const phrase = match[0].toLowerCase()
      if (!seen.has(phrase)) {
        seen.add(phrase)
        results.push({ phrase, category })
      }
    }
  }

  return results
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/sensitive-classifier.test.ts
```
Expected: all 9 tests PASS

- [ ] **Step 5: Integrate `detectSensitiveMatches` into the draft suggest route**

In `app/api/conversations/[id]/draft/suggest/route.ts`, import `detectSensitiveMatches` and add it to the metadata stored with the draft. Find the section where `metadataJson` is built and spread in `sensitiveMatches`:

```typescript
// Add import at the top:
import { detectSensitiveMatches } from "@/lib/agent/risk-radar"

// Inside the route handler, before the prisma.draft.upsert call,
// build conversation text and detect matches:
const allText = context.messages.map((m: { body: string }) => m.body).join("\n")
const sensitiveMatches = detectSensitiveMatches(allText)

// In the metadataJson object being written to the draft, add:
// sensitiveMatches: sensitiveMatches.length > 0 ? sensitiveMatches : undefined,
```

The exact location will vary — search for where `metadataJson` is assembled in that route and add `sensitiveMatches` there.

- [ ] **Step 6: Show sensitive match chips in `AIDraftPanel.tsx`**

In `app/conversations/[id]/AIDraftPanel.tsx`, after the draft textarea and before the send button, add:

```tsx
{/* Sensitive content warning — shown when matches detected in metadata */}
{(() => {
  const meta = draft?.metadataJson as Record<string, unknown> | null | undefined
  const matches = meta?.sensitiveMatches
  if (!Array.isArray(matches) || matches.length === 0) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-medium text-amber-800">Sensitive content detected — review carefully before sending:</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {(matches as Array<{ phrase: string; category: string }>).map(({ phrase, category }) => (
          <span
            key={phrase}
            className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-xs text-amber-700"
            title={category}
          >
            {phrase}
          </span>
        ))}
      </div>
    </div>
  )
})()}
```

- [ ] **Step 7: Run full test suite and lint**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint
```
Expected: all tests pass, no lint errors

- [ ] **Step 8: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add lib/agent/risk-radar.ts app/api/conversations/\[id\]/draft/suggest/route.ts app/conversations/\[id\]/AIDraftPanel.tsx tests/sensitive-classifier.test.ts && git commit -m "feat: richer sensitive detection with category labels + draft highlight chips"
```

---

## Task 2: Schema Migration — Per-Category Confidence Thresholds

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260615000000_add_category_thresholds/migration.sql`

- [ ] **Step 1: Add `categoryThresholdsJson` to `AutopilotSetting` in `prisma/schema.prisma`**

Find the `AutopilotSetting` model and add the new field after `allowedIntentsJson`:

```prisma
model AutopilotSetting {
  id                   String    @id @default(cuid())
  tenantId             String    @unique
  enabled              Boolean   @default(false)
  confidenceThreshold  Float     @default(0.85)
  allowedIntentsJson   Json?
  categoryThresholdsJson Json?   // NEW: per-intent override thresholds {"FAQ": 0.7, "Complaint": 0.95}
  maxAutoSendsPerDay   Int       @default(10)
  disableAfterFailures Int       @default(3)
  currentFailures      Int       @default(0)
  disabledAt           DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  tenant               Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Write the migration SQL**

Create file `prisma/migrations/20260615000000_add_category_thresholds/migration.sql`:

```sql
ALTER TABLE "AutopilotSetting" ADD COLUMN IF NOT EXISTS "categoryThresholdsJson" JSONB;
```

- [ ] **Step 3: Apply the migration**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx prisma db execute --file prisma/migrations/20260615000000_add_category_thresholds/migration.sql --schema prisma/schema.prisma && npx prisma migrate resolve --applied 20260615000000_add_category_thresholds && npx prisma generate
```
Expected: `Database changes applied`, `Migration marked as applied`, client regenerated

- [ ] **Step 4: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add prisma/schema.prisma prisma/migrations/20260615000000_add_category_thresholds/ && git commit -m "feat: add categoryThresholdsJson to AutopilotSetting for per-intent confidence gates"
```

---

## Task 3: Per-Category Confidence Thresholds — Autopilot Logic + Settings UI

**Files:**
- Modify: `lib/agent/autopilot.ts`
- Modify: `app/api/autopilot-settings/route.ts`
- Modify: `app/settings/AutopilotSettingsForm.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Update `checkAutopilotEligibility` in `lib/agent/autopilot.ts`**

After the existing global `confidenceThreshold` check, add a per-category check. The `categoryThresholdsJson` is a `Record<string, number>` keyed by intent (e.g. `{ "Complaint": 0.95, "FAQ": 0.7 }`).

Find the block:
```typescript
if (classification.confidence < setting.confidenceThreshold) {
  return {
    eligible: false,
    reason: `Confidence ${classification.confidence.toFixed(2)} is below threshold ${setting.confidenceThreshold}`,
  }
}
```

And replace it with:

```typescript
// Global threshold check
if (classification.confidence < setting.confidenceThreshold) {
  return {
    eligible: false,
    reason: `Confidence ${classification.confidence.toFixed(2)} is below global threshold ${setting.confidenceThreshold}`,
  }
}

// Per-category threshold override
if (setting.categoryThresholdsJson) {
  const categoryThresholds = setting.categoryThresholdsJson as Record<string, number>
  const intentKey = classification.intent
  const categoryThreshold = categoryThresholds[intentKey]
  if (typeof categoryThreshold === "number" && classification.confidence < categoryThreshold) {
    return {
      eligible: false,
      reason: `Confidence ${classification.confidence.toFixed(2)} is below per-category threshold ${categoryThreshold} for intent "${intentKey}"`,
    }
  }
}
```

- [ ] **Step 2: Update the autopilot-settings PATCH route to accept `categoryThresholds`**

In `app/api/autopilot-settings/route.ts`, find the PATCH handler. Add `categoryThresholds` to the body parsing and the `prisma.autopilotSetting.upsert` data:

```typescript
// Add to body destructuring:
const { enabled, confidenceThreshold, allowedIntents, maxAutoSendsPerDay, disableAfterFailures, categoryThresholds, resetFailures } = body

// Add to the upsert data object:
...(categoryThresholds !== undefined ? { categoryThresholdsJson: categoryThresholds } : {}),
```

- [ ] **Step 3: Update `AutopilotSettingsForm.tsx` to show per-category threshold inputs**

Add state and UI for category thresholds. Insert after the existing confidence threshold input:

```tsx
// Add to AutopilotSnapshot type:
categoryThresholds: Record<string, number>

// Add state:
const [categoryThresholds, setCategoryThresholds] = useState<Record<string, number>>(
  initial?.categoryThresholds ?? {}
)

// Add to handleSave body:
categoryThresholds,

// Add UI after the confidence threshold input block, inside the space-y-3 div:
<div>
  <p className="text-xs font-medium text-slate-600">Per-intent confidence overrides (optional)</p>
  <p className="mt-0.5 text-xs text-slate-400">
    Set a stricter threshold for specific intents, e.g. Complaint → 0.95.
  </p>
  <div className="mt-2 space-y-2">
    {INTENT_OPTIONS.map((intent) => (
      <div key={intent} className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-xs text-slate-600">{intent}</span>
        <input
          type="number"
          step={0.05}
          min={0.5}
          max={1.0}
          placeholder="—"
          value={categoryThresholds[intent] ?? ""}
          onChange={(e) => {
            const val = e.target.value === "" ? undefined : parseFloat(e.target.value)
            setCategoryThresholds((prev) => {
              const next = { ...prev }
              if (val === undefined) delete next[intent]
              else next[intent] = val
              return next
            })
          }}
          className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>
    ))}
  </div>
</div>
```

- [ ] **Step 4: Pass `categoryThresholds` from settings page to `AutopilotSettingsForm`**

In `app/settings/page.tsx`, find where `autopilotSetting` is queried and add `categoryThresholdsJson` to the select, then pass it to the form:

```typescript
// In the prisma query for autopilotSetting, add to select:
categoryThresholdsJson: true,

// When building the initial prop for AutopilotSettingsForm:
categoryThresholds: (autopilotSetting?.categoryThresholdsJson as Record<string, number> | null) ?? {},
```

- [ ] **Step 5: Run tests and lint**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint
```
Expected: all tests pass, no lint errors

- [ ] **Step 6: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add lib/agent/autopilot.ts app/api/autopilot-settings/route.ts app/settings/AutopilotSettingsForm.tsx app/settings/page.tsx && git commit -m "feat: per-category confidence thresholds in autopilot settings"
```

---

## Task 4: Attention-Category Correction API

**Files:**
- Create: `app/api/conversations/[id]/attention/route.ts`
- Create: `tests/attention-correction.test.ts`

- [ ] **Step 1: Write failing tests for the attention correction route**

```typescript
// tests/attention-correction.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma, mockGetServerSession } = vi.hoisted(() => {
  const mockPrisma = {
    conversationState: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  }
  const mockGetServerSession = vi.fn()
  return { mockPrisma, mockGetServerSession }
})

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { PATCH } from "@/app/api/conversations/[id]/attention/route"
import { NextRequest } from "next/server"

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/conversations/conv1/attention", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/conversations/[id]/attention", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1" } })
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: "conv1", tenantId: "t1" })
    mockPrisma.conversationState.findUnique.mockResolvedValue({
      id: "cs1",
      metadataJson: { emailType: "needs_reply" },
    })
    mockPrisma.conversationState.update.mockResolvedValue({})
    mockPrisma.auditLog.create.mockResolvedValue({})
  })

  it("updates attentionCategory in metadataJson", async () => {
    const res = await PATCH(makeReq({ attentionCategory: "read_later" }), {
      params: { id: "conv1" },
    })
    expect(res.status).toBe(200)
    expect(mockPrisma.conversationState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadataJson: expect.objectContaining({ attentionCategory: "read_later" }),
        }),
      })
    )
  })

  it("rejects invalid attentionCategory", async () => {
    const res = await PATCH(makeReq({ attentionCategory: "not_valid" }), {
      params: { id: "conv1" },
    })
    expect(res.status).toBe(400)
  })

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await PATCH(makeReq({ attentionCategory: "read_later" }), {
      params: { id: "conv1" },
    })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/attention-correction.test.ts
```
Expected: FAIL — cannot find module

- [ ] **Step 3: Create `app/api/conversations/[id]/attention/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { AttentionCategory } from "@/lib/agent/email-classifier"

const VALID_CATEGORIES: AttentionCategory[] = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
]

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const conversationId = params.id
  const body = await req.json()
  const { attentionCategory } = body

  if (!VALID_CATEGORIES.includes(attentionCategory)) {
    return NextResponse.json({ error: "Invalid attentionCategory" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const existing = await prisma.conversationState.findUnique({
    where: { conversationId },
    select: { id: true, metadataJson: true },
  })

  const prevMeta =
    existing?.metadataJson && typeof existing.metadataJson === "object" && !Array.isArray(existing.metadataJson)
      ? (existing.metadataJson as Record<string, unknown>)
      : {}

  if (!existing) {
    return NextResponse.json({ error: "No conversation state found" }, { status: 404 })
  }

  await prisma.conversationState.update({
    where: { conversationId },
    data: {
      metadataJson: {
        ...prevMeta,
        attentionCategory,
        attentionCorrectedByUser: true,
        attentionCorrectedAt: new Date().toISOString(),
      },
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "conversation.attention_corrected",
      payloadJson: {
        conversationId,
        attentionCategory,
        previous: prevMeta.attentionCategory ?? null,
        reason: "User manually corrected attention category",
      },
    },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/attention-correction.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: Add attention-category correction dropdown to the conversation page**

In `app/conversations/[id]/page.tsx`, find where the conversation status and label are displayed (in the Contact + Label card in the sidebar). Add an attention-category selector below the label select.

First, create the client component inline or as a small component. Add to the sidebar, after the `LabelSelect` component:

```tsx
{/* Attention category correction — shown for both personal and business */}
<AttentionCorrectionSelect
  conversationId={conversation.id}
  current={(conversationState?.metadataJson as Record<string, unknown> | null)?.attentionCategory as string | undefined}
/>
```

Create `app/conversations/[id]/AttentionCorrectionSelect.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

const CATEGORY_LABELS: Record<string, string> = {
  needs_reply: "Needs Reply",
  needs_action: "Needs Action",
  review_soon: "Review Soon",
  read_later: "Read Later",
  waiting_on: "Waiting On",
  fyi_done: "FYI / Done",
  quiet: "Quiet",
}

export default function AttentionCorrectionSelect({
  conversationId,
  current,
}: {
  conversationId: string
  current?: string
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    if (!value) return
    setSaving(true)
    try {
      await fetch(`/api/conversations/${conversationId}/attention`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attentionCategory: value }),
      })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2">
      <label className="text-xs text-slate-500">Attention</label>
      <select
        value={current ?? ""}
        onChange={handleChange}
        disabled={saving}
        className="mt-0.5 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
      >
        <option value="">— not set —</option>
        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </div>
  )
}
```

Import and wire it in `page.tsx`.

- [ ] **Step 6: Run full test suite**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint
```
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add app/api/conversations/\[id\]/attention/ app/conversations/\[id\]/AttentionCorrectionSelect.tsx app/conversations/\[id\]/page.tsx tests/attention-correction.test.ts && git commit -m "feat: attention-category correction API and dropdown on conversation page"
```

---

## Task 5: Attention Filter Tabs on Inbox + Bulk-Close API

**Files:**
- Create: `app/api/conversations/bulk-close/route.ts`
- Modify: `app/inbox/page.tsx`
- Create: `tests/bulk-close.test.ts`

- [ ] **Step 1: Write failing test for bulk-close route**

```typescript
// tests/bulk-close.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma, mockGetServerSession } = vi.hoisted(() => {
  const mockPrisma = {
    conversationState: {
      findMany: vi.fn(),
    },
    conversation: {
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  }
  const mockGetServerSession = vi.fn()
  return { mockPrisma, mockGetServerSession }
})

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { POST } from "@/app/api/conversations/bulk-close/route"
import { NextRequest } from "next/server"

describe("POST /api/conversations/bulk-close", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1" } })
    mockPrisma.conversationState.findMany.mockResolvedValue([
      { conversationId: "c1" },
      { conversationId: "c2" },
    ])
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 2 })
    mockPrisma.auditLog.create.mockResolvedValue({})
  })

  it("closes all FYI/quiet conversations and returns count", async () => {
    const req = new NextRequest("http://localhost/api/conversations/bulk-close", { method: "POST" })
    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.closed).toBe(2)
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "closed" },
      })
    )
  })

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const req = new NextRequest("http://localhost/api/conversations/bulk-close", { method: "POST" })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/bulk-close.test.ts
```
Expected: FAIL — cannot find module

- [ ] **Step 3: Create `app/api/conversations/bulk-close/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  // Find conversation IDs where attentionCategory is quiet or fyi_done
  const quietStates = await prisma.conversationState.findMany({
    where: {
      tenantId,
      OR: [
        { metadataJson: { path: ["attentionCategory"], equals: "quiet" } },
        { metadataJson: { path: ["attentionCategory"], equals: "fyi_done" } },
        { state: "fyi_only" },
      ],
    },
    select: { conversationId: true },
  })

  const ids = quietStates.map((s) => s.conversationId)

  if (ids.length === 0) {
    return NextResponse.json({ closed: 0 })
  }

  const result = await prisma.conversation.updateMany({
    where: { id: { in: ids }, tenantId, status: { not: "closed" } },
    data: { status: "closed" },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "inbox.bulk_close_fyi",
      payloadJson: {
        closedCount: result.count,
        conversationIds: ids,
        reason: "User bulk-archived safely-ignored conversations",
      },
    },
  })

  return NextResponse.json({ closed: result.count })
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/bulk-close.test.ts
```
Expected: 2 tests PASS

- [ ] **Step 5: Add `?attention=<category>` filter support and bulk-close button to `app/inbox/page.tsx`**

**5a.** Add `attention` to the `Props.searchParams` type and read it:

```typescript
interface Props {
  searchParams: { status?: string; q?: string; sales?: string; attention?: string };
}
// In the component:
const attentionFilter = searchParams.attention ?? ""
```

**5b.** After the existing `displayConversations` filter for `salesFilter`, add:

```typescript
const displayConversations = salesFilter
  ? mobileConversations.filter(/* existing sales filter */)
  : attentionFilter
  ? mobileConversations.filter((c) => {
      const meta = c.stateRecord?.metadataJson
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false
      return (meta as Record<string, unknown>).attentionCategory === attentionFilter
    })
  : mobileConversations
```

**5c.** Add `tabHref` support for attention:

```typescript
function attentionTabHref(category: string) {
  const params = new URLSearchParams()
  params.set("attention", category)
  if (q) params.set("q", q)
  return `/inbox?${params.toString()}`
}
```

**5d.** In the mobile nav tabs section (after the Sales tab), add attention filter tabs. Keep it to the 3 most useful ones to avoid overflow:

```tsx
{(["needs_reply", "review_soon", "read_later"] as const).map((cat) => {
  const labels: Record<string, string> = { needs_reply: "Reply", review_soon: "Review", read_later: "Later" }
  const isActive = attentionFilter === cat && !salesFilter && !activeStatus
  return (
    <Link
      key={cat}
      href={attentionTabHref(cat)}
      className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
        isActive
          ? "border-blue-600 text-blue-700"
          : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {labels[cat]}
    </Link>
  )
})}
```

**5e.** Add the bulk-close button on the home view. In the `isHomeView` section, below the `HomeCommandCenter` component, add a `BulkCloseButton` client component. Create `app/inbox/BulkCloseButton.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function BulkCloseButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<number | null>(null)

  async function handleClick() {
    if (!confirm("Archive all safely-ignored (quiet / FYI done) conversations?")) return
    setLoading(true)
    try {
      const res = await fetch("/api/conversations/bulk-close", { method: "POST" })
      const data = await res.json()
      setResult(data.closed ?? 0)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60"
      >
        {loading ? "Archiving…" : "Archive all safely ignored"}
      </button>
      {result !== null && (
        <p className="text-xs text-slate-500">{result} conversation{result !== 1 ? "s" : ""} archived.</p>
      )}
    </div>
  )
}
```

Import and render `<BulkCloseButton />` in `app/inbox/page.tsx` inside the `isHomeView` block.

- [ ] **Step 6: Run full test suite**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint
```
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add app/api/conversations/bulk-close/ app/inbox/page.tsx app/inbox/BulkCloseButton.tsx tests/bulk-close.test.ts && git commit -m "feat: attention-category filter tabs + safely-ignored bulk archive"
```

---

## Task 6: Command-Center Bills & Deadline Signals

**Files:**
- Modify: `lib/agent/command-center.ts`
- Modify: `app/inbox/page.tsx` (pass upcoming tasks to HomeCommandCenter)
- Modify: `app/components/HomeCommandCenter.tsx` (show bills section)

- [ ] **Step 1: Add `buildBillsSection` to `lib/agent/command-center.ts`**

Add the following type and function after the existing exports. It surfaces upcoming `InboxTask` records (dueAt within 7 days) and `review_soon` conversations as a "bills and deadlines" section:

```typescript
export type BillSignal = {
  conversationId: string
  displayName: string
  href: string
  title: string
  dueAt: Date | null
  type: "task" | "billing_alert"
}

export type BillsSection = {
  items: BillSignal[]
  count: number
}

export function buildBillsSection(
  tasks: Array<{
    id: string
    conversationId: string
    title: string
    dueAt: Date | null
    conversation: { contact: { name: string } | null; externalThreadId: string }
  }>,
  conversations: CommandCenterInputConversation[],
  now = new Date()
): BillsSection {
  const items: BillSignal[] = []
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // Upcoming tasks with due dates
  for (const task of tasks) {
    if (task.dueAt && task.dueAt <= sevenDays) {
      const name = task.conversation.contact?.name ?? task.conversation.externalThreadId
      items.push({
        conversationId: task.conversationId,
        displayName: name,
        href: `/conversations/${task.conversationId}`,
        title: task.title,
        dueAt: task.dueAt,
        type: "task",
      })
    }
  }

  // Conversations with billing alert attention category
  for (const conv of conversations) {
    const meta = conv.conversationState?.metadataJson
    const category =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as Record<string, unknown>).attentionCategory
        : null
    if (category === "review_soon") {
      const name = conv.contact?.name ?? conv.externalThreadId
      items.push({
        conversationId: conv.id,
        displayName: name,
        href: `/conversations/${conv.id}`,
        title: "Billing or security alert",
        dueAt: null,
        type: "billing_alert",
      })
    }
  }

  // Sort by dueAt ascending (nulls last)
  items.sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return 0
    if (!a.dueAt) return 1
    if (!b.dueAt) return -1
    return a.dueAt.getTime() - b.dueAt.getTime()
  })

  return { items: items.slice(0, 8), count: items.length }
}
```

- [ ] **Step 2: Fetch upcoming tasks in `app/inbox/page.tsx` for the home view**

In the `isHomeView` block (inside the `Promise.all`), add a task query:

```typescript
const upcomingTasks = isHomeView
  ? await prisma.inboxTask.findMany({
      where: {
        tenantId,
        status: "open",
        dueAt: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { dueAt: "asc" },
      take: 10,
      include: {
        conversation: {
          include: { contact: { select: { name: true } } },
        },
      },
    })
  : []
```

Build the bills section and pass it to `HomeCommandCenter`:

```typescript
import { buildBillsSection, BillsSection } from "@/lib/agent/command-center"
// ...
const billsSection = isHomeView
  ? buildBillsSection(upcomingTasks, commandCenterConversations as CommandCenterInputConversation[])
  : { items: [], count: 0 }
```

Pass `billsSection={billsSection}` to both `HomeCommandCenter` renders.

- [ ] **Step 3: Display bills section in `app/components/HomeCommandCenter.tsx`**

Find the `HomeCommandCenter` component props type and add `billsSection: BillsSection`. Then add a bills card to the layout — place it in the left column after the follow-ups tracker section:

```tsx
{/* Bills & Deadlines */}
{billsSection.count > 0 && (
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <h3 className="text-sm font-semibold text-slate-700">
      Bills &amp; Deadlines
      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        {billsSection.count}
      </span>
    </h3>
    <ul className="mt-3 space-y-2">
      {billsSection.items.map((item) => (
        <li key={`${item.conversationId}-${item.title}`}>
          <a href={item.href} className="flex items-start justify-between gap-2 text-sm hover:underline">
            <span className="min-w-0">
              <span className="font-medium text-slate-800">{item.displayName}</span>
              <span className="ml-1.5 text-slate-500">{item.title}</span>
            </span>
            {item.dueAt && (
              <span className="shrink-0 whitespace-nowrap text-xs text-amber-600">
                Due {item.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
          </a>
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 4: Run tests and lint**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add lib/agent/command-center.ts app/inbox/page.tsx app/components/HomeCommandCenter.tsx && git commit -m "feat: bills and deadlines section in command center from tasks and review-soon signals"
```

---

## Task 7: Trust UX — "Why" Column + Undo on Audit Log

**Files:**
- Create: `app/api/audit/[id]/undo/route.ts`
- Modify: `app/audit/page.tsx`

- [ ] **Step 1: Create `app/api/audit/[id]/undo/route.ts`**

Support undoing `autopilot.draft_approved` (set draft back to proposed) and `inbox.bulk_close_fyi` (no-op, inform user). Extend later as needed.

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const UNDOABLE_ACTIONS = new Set(["autopilot.draft_approved"])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const logId = params.id

  const log = await prisma.auditLog.findFirst({
    where: { id: logId, tenantId },
  })
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!UNDOABLE_ACTIONS.has(log.action)) {
    return NextResponse.json({ error: "This action cannot be undone" }, { status: 422 })
  }

  const payload = log.payloadJson as Record<string, unknown>

  if (log.action === "autopilot.draft_approved") {
    const draftId = payload.draftId as string | undefined
    if (!draftId) return NextResponse.json({ error: "No draft ID in log" }, { status: 422 })

    await prisma.draft.update({
      where: { id: draftId },
      data: { status: "proposed" },
    })

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id ?? null,
        action: "autopilot.draft_approval_undone",
        payloadJson: {
          originalLogId: logId,
          draftId,
          reason: "User undid autopilot draft approval",
        },
      },
    })

    return NextResponse.json({ ok: true, message: "Draft set back to proposed for review." })
  }

  return NextResponse.json({ error: "Undo not implemented for this action" }, { status: 422 })
}
```

- [ ] **Step 2: Update `app/audit/page.tsx` to show "Why" column and undo button**

**2a.** Add a "Why" column to the table header:
```tsx
<th className="px-4 py-3 text-left font-medium">Why</th>
```

**2b.** Add the "Why" cell and undo button in each row. Replace the last `<td>` (Details) with:

```tsx
<td className="px-4 py-3 text-xs text-slate-500">
  {payload.conversationId ? (
    <Link href={`/conversations/${payload.conversationId}`} className="underline hover:text-slate-700">
      {String(payload.conversationId).slice(-8)}
    </Link>
  ) : null}
  {payload.intent != null && (
    <span className="ml-2 text-slate-400">
      intent: {String(payload.intent)}{" "}
      {payload.confidence != null ? `(${(Number(payload.confidence) * 100).toFixed(0)}%)` : ""}
    </span>
  )}
  {payload.error != null && <span className="ml-2 text-red-500">{String(payload.error)}</span>}
</td>
<td className="px-4 py-3 text-xs text-slate-500 max-w-xs">
  {payload.reason ? String(payload.reason) : <span className="text-slate-300">—</span>}
</td>
<td className="px-4 py-3 text-xs">
  {log.action === "autopilot.draft_approved" && (
    <form action={`/api/audit/${log.id}/undo`} method="POST">
      <button
        type="submit"
        className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
      >
        Undo
      </button>
    </form>
  )}
</td>
```

Also add "Why" and "Undo" headers to the `<thead>`.

Note: The undo button uses a plain form POST for simplicity. For a better UX, convert it to a client component later.

- [ ] **Step 3: Make audit page available to personal accounts**

Currently `app/audit/page.tsx` redirects personal accounts to `/inbox`. Change this to show a limited view (personal accounts see their own classification actions):

Replace:
```typescript
if (tenant?.accountType === "personal") redirect("/inbox")
```

With:
```typescript
// Personal accounts can view audit log but only their own actions (no redirect)
const isPersonal = tenant?.accountType === "personal"
const auditActionsForPersonal = [
  "conversation.attention_corrected",
  "person_memory.synced",
  "draft.suggest",
  "draft.approve",
  "draft.sent",
]
```

Update the `where` filter to include these personal-safe actions:
```typescript
const where = {
  tenantId,
  ...(filterAction
    ? { action: filterAction }
    : { action: { in: isPersonal ? auditActionsForPersonal : AGENT_ACTIONS } }),
}
```

- [ ] **Step 4: Run full test suite**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add app/api/audit/\[id\]/undo/ app/audit/page.tsx && git commit -m "feat: trust UX — why column and undo on audit log, personal account access"
```

---

## Task 8: Manual Task Creation

**Files:**
- Create: `app/api/tasks/route.ts`
- Create: `app/conversations/[id]/ManualTaskForm.tsx`
- Modify: `app/conversations/[id]/WorkItemsPanel.tsx`
- Modify: `app/conversations/[id]/page.tsx`
- Create: `tests/manual-task.test.ts`

- [ ] **Step 1: Write failing test for `POST /api/tasks`**

```typescript
// tests/manual-task.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma, mockGetServerSession } = vi.hoisted(() => {
  const mockPrisma = {
    conversation: { findFirst: vi.fn() },
    inboxTask: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  const mockGetServerSession = vi.fn()
  return { mockPrisma, mockGetServerSession }
})

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { POST } from "@/app/api/tasks/route"
import { NextRequest } from "next/server"

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/tasks", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1" } })
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: "conv1", tenantId: "t1" })
    mockPrisma.inboxTask.create.mockResolvedValue({ id: "task1", title: "Send proposal" })
    mockPrisma.auditLog.create.mockResolvedValue({})
  })

  it("creates a task with source manual", async () => {
    const res = await POST(makeReq({ conversationId: "conv1", title: "Send proposal", dueAt: null }))
    expect(res.status).toBe(201)
    expect(mockPrisma.inboxTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Send proposal",
          source: "manual",
          tenantId: "t1",
        }),
      })
    )
  })

  it("rejects empty title", async () => {
    const res = await POST(makeReq({ conversationId: "conv1", title: "", dueAt: null }))
    expect(res.status).toBe(400)
  })

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await POST(makeReq({ conversationId: "conv1", title: "Task", dueAt: null }))
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/manual-task.test.ts
```

- [ ] **Step 3: Create `app/api/tasks/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const body = await req.json()
  const { conversationId, title, dueAt } = body

  if (!title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 })
  if (!conversationId) return NextResponse.json({ error: "conversationId is required" }, { status: 400 })

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const task = await prisma.inboxTask.create({
    data: {
      tenantId,
      conversationId,
      title: title.trim(),
      status: "open",
      source: "manual",
      deterministicKey: `manual_${conversationId}_${Date.now()}`,
      dueAt: dueAt ? new Date(dueAt) : null,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "task.manually_created",
      payloadJson: { taskId: task.id, conversationId, title: task.title, reason: "User manually created a task" },
    },
  })

  return NextResponse.json({ task }, { status: 201 })
}
```

- [ ] **Step 4: Run test to confirm passes**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/manual-task.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: Create `app/conversations/[id]/ManualTaskForm.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function ManualTaskForm({
  conversationId,
  onDone,
}: {
  conversationId: string
  onDone: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [dueAt, setDueAt] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, title: title.trim(), dueAt: dueAt || null }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? "Failed to create task")
      }
      setTitle("")
      setDueAt("")
      router.refresh()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <input
        type="text"
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        autoFocus
      />
      <input
        type="date"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Adding…" : "Add task"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 6: Update `WorkItemsPanel.tsx` to show "Add task" button**

Add `conversationId` prop and a toggle for showing `ManualTaskForm`. In `WorkItemsPanel`:

```tsx
// Add to props:
conversationId: string

// Add state:
const [showTaskForm, setShowTaskForm] = useState(false)

// Import ManualTaskForm:
import ManualTaskForm from "@/app/conversations/[id]/ManualTaskForm"

// At the bottom of the tasks list, before the closing div:
<button
  type="button"
  onClick={() => setShowTaskForm(true)}
  className="mt-2 text-xs text-blue-600 hover:underline"
>
  + Add task
</button>
{showTaskForm && (
  <ManualTaskForm
    conversationId={conversationId}
    onDone={() => setShowTaskForm(false)}
  />
)}
```

In `app/conversations/[id]/page.tsx`, pass `conversationId={conversation.id}` to `WorkItemsPanel`.

- [ ] **Step 7: Run full test suite**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint
```

- [ ] **Step 8: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add app/api/tasks/ app/conversations/\[id\]/ManualTaskForm.tsx app/conversations/\[id\]/WorkItemsPanel.tsx app/conversations/\[id\]/page.tsx tests/manual-task.test.ts && git commit -m "feat: manual task creation from conversation sidebar"
```

---

## Task 9: Person-Memory Editing UI + LLM Extraction Upgrade

**Files:**
- Create: `app/api/person-memory/[contactId]/route.ts`
- Create: `app/conversations/[id]/PersonMemoryEditPanel.tsx`
- Create: `lib/ai/prompts/person-memory-extract.ts`
- Modify: `lib/agent/person-memory.ts`
- Modify: `app/conversations/[id]/page.tsx`
- Create: `tests/person-memory-edit.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/person-memory-edit.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma, mockGetServerSession } = vi.hoisted(() => {
  const mockPrisma = {
    personMemory: { findFirst: vi.fn(), update: vi.fn() },
    contact: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  const mockGetServerSession = vi.fn()
  return { mockPrisma, mockGetServerSession }
})

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { PATCH } from "@/app/api/person-memory/[contactId]/route"
import { NextRequest } from "next/server"

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/person-memory/c1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/person-memory/[contactId]", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1" } })
    mockPrisma.personMemory.findFirst.mockResolvedValue({ id: "pm1", tenantId: "t1" })
    mockPrisma.personMemory.update.mockResolvedValue({})
    mockPrisma.auditLog.create.mockResolvedValue({})
  })

  it("updates summary and preferences", async () => {
    const res = await PATCH(makeReq({ summary: "Updated summary", preferences: "Prefers short replies" }), {
      params: { contactId: "c1" },
    })
    expect(res.status).toBe(200)
    expect(mockPrisma.personMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: "Updated summary",
          preferences: "Prefers short replies",
        }),
      })
    )
  })

  it("returns 404 when no memory exists", async () => {
    mockPrisma.personMemory.findFirst.mockResolvedValue(null)
    const res = await PATCH(makeReq({ summary: "x" }), { params: { contactId: "c1" } })
    expect(res.status).toBe(404)
  })

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await PATCH(makeReq({ summary: "x" }), { params: { contactId: "c1" } })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/person-memory-edit.test.ts
```

- [ ] **Step 3: Create `app/api/person-memory/[contactId]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: { contactId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const { contactId } = params
  const body = await req.json()
  const { summary, preferences, openQuestions, promisedActions } = body

  const existing = await prisma.personMemory.findFirst({
    where: { contactId, tenantId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.personMemory.update({
    where: { id: existing.id },
    data: {
      ...(summary !== undefined ? { summary } : {}),
      ...(preferences !== undefined ? { preferences } : {}),
      ...(openQuestions !== undefined ? { openQuestions } : {}),
      ...(promisedActions !== undefined ? { promisedActions } : {}),
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "person_memory.user_edited",
      payloadJson: { contactId, reason: "User manually edited person memory" },
    },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run test to confirm passes**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/person-memory-edit.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: Create `lib/ai/prompts/person-memory-extract.ts`**

```typescript
export type PersonMemoryExtractInput = {
  contactName: string
  messages: Array<{ direction: "inbound" | "outbound"; body: string; createdAt: Date }>
}

export type PersonMemoryExtractResult = {
  summary: string
  preferences: string | null
  openQuestions: string | null
  promisedActions: string | null
}

export function buildPersonMemoryExtractPrompt(input: PersonMemoryExtractInput): string {
  const recent = input.messages.slice(-30)
  const formatted = recent
    .map((m) => `[${m.direction === "inbound" ? input.contactName : "You"}] ${m.body.slice(0, 200)}`)
    .join("\n")

  return `You are analyzing email conversations with ${input.contactName} to build a relationship memory card.

CONVERSATION HISTORY (recent messages):
${formatted}

Extract the following about ${input.contactName}. Return ONLY valid JSON with these keys:
- summary: A 2-3 sentence factual summary of who this person is and what they have communicated about.
- preferences: A short note on how they like to communicate (tone, length, timing), or null if unclear.
- openQuestions: Questions they asked that haven't been answered yet, or null if none.
- promisedActions: Things you (the email owner) have promised or committed to for them, or null if none.

Strict rules:
- No invented facts. Only infer from the messages shown.
- Keep each field under 200 characters.
- Return null for fields with no evidence.

JSON:`
}

export function normalizePersonMemoryExtractResult(raw: unknown): PersonMemoryExtractResult | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.summary !== "string") return null
  return {
    summary: r.summary.slice(0, 500),
    preferences: typeof r.preferences === "string" ? r.preferences.slice(0, 300) : null,
    openQuestions: typeof r.openQuestions === "string" ? r.openQuestions.slice(0, 300) : null,
    promisedActions: typeof r.promisedActions === "string" ? r.promisedActions.slice(0, 300) : null,
  }
}
```

- [ ] **Step 6: Add `syncPersonMemoryWithLLM` to `lib/agent/person-memory.ts`**

Add the following export at the bottom of the file:

```typescript
import OpenAI from "openai"
import { buildPersonMemoryExtractPrompt, normalizePersonMemoryExtractResult } from "@/lib/ai/prompts/person-memory-extract"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function syncPersonMemoryWithLLM(
  tenantId: string,
  contactId: string
): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    include: {
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 10,
        include: {
          messages: { orderBy: { createdAt: "asc" }, take: 30 },
        },
      },
    },
  })
  if (!contact) return

  const allMessages = contact.conversations
    .flatMap((c) => c.messages)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((m) => ({ direction: m.direction as "inbound" | "outbound", body: m.body, createdAt: m.createdAt }))

  if (allMessages.length < 3) {
    // Fall back to deterministic extraction when insufficient data
    return syncPersonMemory(tenantId, contactId)
  }

  const prompt = buildPersonMemoryExtractPrompt({ contactName: contact.name, messages: allMessages })

  let extracted: ReturnType<typeof normalizePersonMemoryExtractResult> = null
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 500,
    })
    const content = response.choices[0]?.message?.content
    if (content) {
      extracted = normalizePersonMemoryExtractResult(JSON.parse(content))
    }
  } catch {
    // Fall back to deterministic on LLM error
    return syncPersonMemory(tenantId, contactId)
  }

  if (!extracted) return syncPersonMemory(tenantId, contactId)

  await prisma.personMemory.upsert({
    where: { contactId },
    create: {
      tenantId,
      contactId,
      lastContactAt: allMessages[allMessages.length - 1]?.createdAt ?? null,
      messageCount: allMessages.length,
      summary: extracted.summary,
      preferences: extracted.preferences,
      openQuestions: extracted.openQuestions,
      promisedActions: extracted.promisedActions,
    },
    update: {
      lastContactAt: allMessages[allMessages.length - 1]?.createdAt ?? null,
      messageCount: allMessages.length,
      summary: extracted.summary,
      preferences: extracted.preferences,
      openQuestions: extracted.openQuestions,
      promisedActions: extracted.promisedActions,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "person_memory.synced_llm",
      payloadJson: { contactId, messageCount: allMessages.length },
    },
  })
}
```

- [ ] **Step 7: Create `app/conversations/[id]/PersonMemoryEditPanel.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type Fields = {
  summary: string
  preferences: string
  openQuestions: string
  promisedActions: string
}

export default function PersonMemoryEditPanel({
  contactId,
  initial,
  onDone,
}: {
  contactId: string
  initial: Partial<Fields>
  onDone: () => void
}) {
  const router = useRouter()
  const [fields, setFields] = useState<Fields>({
    summary: initial.summary ?? "",
    preferences: initial.preferences ?? "",
    openQuestions: initial.openQuestions ?? "",
    promisedActions: initial.promisedActions ?? "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(key: keyof Fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/person-memory/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: fields.summary || null,
          preferences: fields.preferences || null,
          openQuestions: fields.openQuestions || null,
          promisedActions: fields.promisedActions || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? "Failed to save")
      }
      router.refresh()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const fieldLabels: [keyof Fields, string][] = [
    ["summary", "Summary"],
    ["preferences", "Preferences"],
    ["openQuestions", "Open questions"],
    ["promisedActions", "Promised actions"],
  ]

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-700">Edit relationship memory</p>
      {fieldLabels.map(([key, label]) => (
        <div key={key}>
          <label className="text-xs text-slate-500">{label}</label>
          <textarea
            rows={2}
            value={fields[key]}
            onChange={(e) => update(key, e.target.value)}
            placeholder={`${label}…`}
            className="mt-0.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onDone}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Wire `PersonMemoryEditPanel` into `page.tsx`**

In `app/conversations/[id]/page.tsx`, find the relationship memory `CollapsibleCard` in the sidebar. Inside it, add an "Edit" button (client-side toggle) and render `PersonMemoryEditPanel`. Since the page is a server component, wrap the edit toggle in a small client shell:

Create `app/conversations/[id]/PersonMemoryEditShell.tsx`:

```tsx
"use client"

import { useState } from "react"
import PersonMemoryEditPanel from "./PersonMemoryEditPanel"

export default function PersonMemoryEditShell({
  contactId,
  memory,
}: {
  contactId: string
  memory: { summary: string | null; preferences: string | null; openQuestions: string | null; promisedActions: string | null }
}) {
  const [editing, setEditing] = useState(false)

  return (
    <div>
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          className="mt-1 text-xs text-blue-600 hover:underline"
        >
          Edit
        </button>
      )}
      {editing && (
        <PersonMemoryEditPanel
          contactId={contactId}
          initial={{
            summary: memory.summary ?? "",
            preferences: memory.preferences ?? "",
            openQuestions: memory.openQuestions ?? "",
            promisedActions: memory.promisedActions ?? "",
          }}
          onDone={() => setEditing(false)}
        />
      )}
    </div>
  )
}
```

Import and add `<PersonMemoryEditShell contactId={contact.id} memory={personMemory} />` inside the relationship memory card in `page.tsx`, after the existing memory display.

- [ ] **Step 9: Run full test suite**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint
```

- [ ] **Step 10: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add app/api/person-memory/ app/conversations/\[id\]/PersonMemoryEditPanel.tsx app/conversations/\[id\]/PersonMemoryEditShell.tsx lib/ai/prompts/person-memory-extract.ts lib/agent/person-memory.ts tests/person-memory-edit.test.ts && git commit -m "feat: person-memory editing UI and LLM-based extraction upgrade"
```

---

## Task 10: Local-Business Concierge Templates

**Files:**
- Create: `lib/agent/concierge-templates.ts`
- Create: `app/api/settings/seed-templates/route.ts`
- Modify: `app/settings/page.tsx`
- Create: `tests/concierge-templates.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/concierge-templates.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { DEFAULT_CONCIERGE_TEMPLATES, buildTemplateDocument } from "@/lib/agent/concierge-templates"

describe("concierge-templates", () => {
  it("has at least 6 templates", () => {
    expect(DEFAULT_CONCIERGE_TEMPLATES.length).toBeGreaterThanOrEqual(6)
  })

  it("every template has a name, category, and content", () => {
    for (const t of DEFAULT_CONCIERGE_TEMPLATES) {
      expect(t.name).toBeTruthy()
      expect(t.category).toBeTruthy()
      expect(t.content.length).toBeGreaterThan(20)
    }
  })

  it("buildTemplateDocument returns correct shape", () => {
    const doc = buildTemplateDocument(DEFAULT_CONCIERGE_TEMPLATES[0], "t1")
    expect(doc.tenantId).toBe("t1")
    expect(doc.sourceType).toBe("concierge_template")
    expect(doc.title).toContain(DEFAULT_CONCIERGE_TEMPLATES[0].name)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/concierge-templates.test.ts
```

- [ ] **Step 3: Create `lib/agent/concierge-templates.ts`**

```typescript
export type ConciergeTemplate = {
  name: string
  category: "pricing" | "scheduling" | "faq" | "complaint" | "onboarding" | "follow_up"
  content: string
}

export const DEFAULT_CONCIERGE_TEMPLATES: ConciergeTemplate[] = [
  {
    name: "Pricing Inquiry",
    category: "pricing",
    content: `Thank you for reaching out! Our pricing depends on your specific needs and situation. 

To give you an accurate quote, could you share:
1. What service or package you're interested in?
2. How many people or sessions you're looking for?

I'll put together a customized proposal for you right away.`,
  },
  {
    name: "Availability Check",
    category: "scheduling",
    content: `Thanks for getting in touch! I'd love to help you find a time that works.

Let me check our current availability and send you a few options. Do you have a preferred day or time of day that works best for you? We're typically available Monday–Saturday.`,
  },
  {
    name: "Reschedule Request",
    category: "scheduling",
    content: `Of course — no problem at all! I've noted your current appointment and will look for the next available slot that fits.

Could you let me know your preferred days and times? I'll get back to you shortly with a new option.`,
  },
  {
    name: "New Client Welcome",
    category: "onboarding",
    content: `Welcome! We're so glad you've decided to get started with us.

Here's what happens next:
1. You'll receive a confirmation with all the details.
2. Please arrive 5–10 minutes early for your first session.
3. If you have any questions before then, reply to this email and I'll be happy to help.

Looking forward to seeing you soon!`,
  },
  {
    name: "Complaint — Calm Acknowledgment",
    category: "complaint",
    content: `Thank you for taking the time to share this with us. I'm sorry to hear your experience didn't meet your expectations — that's not the standard we hold ourselves to.

I want to make this right for you. Could you give me a bit more detail about what happened? I'll look into it personally and follow up with a resolution as quickly as possible.`,
  },
  {
    name: "FAQ — General Services",
    category: "faq",
    content: `Great question! Here's a quick overview of what we offer:

[Service 1]: Brief description.
[Service 2]: Brief description.
[Service 3]: Brief description.

Sessions are typically [duration] long and are available [days/times]. To get started, you can reply here or book directly at [booking link].

Is there a specific service you'd like to know more about?`,
  },
  {
    name: "Lead Follow-Up (Warm)",
    category: "follow_up",
    content: `Just wanted to follow up on my previous message — I'd love to help you get started and wanted to make sure this didn't get lost in your inbox.

If you have any questions about what we offer or what the next step looks like, I'm happy to chat. Would [day] or [day] work for a quick call?`,
  },
  {
    name: "Missed Appointment",
    category: "scheduling",
    content: `Hi — I noticed we missed you for today's appointment. No worries at all! These things happen.

Whenever you're ready, I'd love to get you rescheduled. Just reply here with a day that works for you and I'll take care of it.`,
  },
]

export type TemplateDocument = {
  tenantId: string
  title: string
  content: string
  sourceType: string
}

export function buildTemplateDocument(template: ConciergeTemplate, tenantId: string): TemplateDocument {
  return {
    tenantId,
    title: `[Template] ${template.name}`,
    content: template.content,
    sourceType: "concierge_template",
  }
}
```

- [ ] **Step 4: Run test to confirm passes**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npx vitest run tests/concierge-templates.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: Create `app/api/settings/seed-templates/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CONCIERGE_TEMPLATES, buildTemplateDocument } from "@/lib/agent/concierge-templates"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  // Only seed for business accounts
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accountType: true },
  })
  if (tenant?.accountType !== "business") {
    return NextResponse.json({ error: "Concierge templates are for business accounts" }, { status: 403 })
  }

  // Only seed if no templates already exist
  const existing = await prisma.knowledgeDocument.count({
    where: { tenantId, sourceType: "concierge_template" },
  })
  if (existing > 0) {
    return NextResponse.json({ seeded: 0, message: "Templates already seeded" })
  }

  await prisma.knowledgeDocument.createMany({
    data: DEFAULT_CONCIERGE_TEMPLATES.map((t) => buildTemplateDocument(t, tenantId)),
  })

  return NextResponse.json({ seeded: DEFAULT_CONCIERGE_TEMPLATES.length })
}
```

- [ ] **Step 6: Add template seeder section to `app/settings/page.tsx`**

In the business-only section (near Knowledge Documents), add a seed button. Create `app/settings/ConciergeTemplateSeedButton.tsx`:

```tsx
"use client"

import { useState } from "react"

export default function ConciergeTemplateSeedButton({ alreadySeeded }: { alreadySeeded: boolean }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(alreadySeeded)
  const [error, setError] = useState<string | null>(null)

  async function handleSeed() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/settings/seed-templates", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed")
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed templates")
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return <p className="text-xs text-green-600">Concierge templates are loaded. Find them in Knowledge Base.</p>
  }

  return (
    <div>
      <p className="text-sm text-slate-600">
        Pre-built reply templates for pricing, scheduling, complaints, onboarding, and follow-ups.
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <button
        onClick={handleSeed}
        disabled={loading}
        className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? "Loading…" : "Load 8 concierge templates"}
      </button>
    </div>
  )
}
```

In `app/settings/page.tsx`, query template count and render the button for business accounts:

```typescript
// Add to the prisma queries (in the Promise.all or separately):
const templateCount = isBusiness
  ? await prisma.knowledgeDocument.count({ where: { tenantId, sourceType: "concierge_template" } })
  : 0

// In the JSX, in the business section:
{isBusiness && (
  <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="text-base font-semibold">Concierge Templates</h2>
    <div className="mt-4">
      <ConciergeTemplateSeedButton alreadySeeded={templateCount > 0} />
    </div>
  </section>
)}
```

Import `ConciergeTemplateSeedButton` at the top.

- [ ] **Step 7: Add template picker to the draft panel for business accounts**

In `app/conversations/[id]/AIDraftPanel.tsx`, when `knowledgeDocuments` are available (they're already passed as context in business mode), filter for `sourceType === "concierge_template"` and show a dropdown above the instruction textarea.

The templates come from the draft context. For the UI, add to `AIDraftPanel` props:
```tsx
conciergeTemplates?: Array<{ id: string; title: string; content: string }>
```

In `app/conversations/[id]/page.tsx`, filter the `knowledgeDocuments` already fetched:
```typescript
const conciergeTemplates = !isPersonal
  ? (knowledgeDocuments ?? [])
      .filter((d: { sourceType: string }) => d.sourceType === "concierge_template")
      .map((d: { id: string; title: string; content: string }) => ({ id: d.id, title: d.title.replace("[Template] ", ""), content: d.content }))
  : []
```

Pass `conciergeTemplates={conciergeTemplates}` to `AIDraftPanel`.

In `AIDraftPanel.tsx`, add a template picker dropdown before the instruction textarea:

```tsx
{conciergeTemplates && conciergeTemplates.length > 0 && (
  <div>
    <label className="text-xs text-slate-500">Start from template</label>
    <select
      className="mt-0.5 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
      defaultValue=""
      onChange={(e) => {
        const tpl = conciergeTemplates.find((t) => t.id === e.target.value)
        if (tpl) {
          setInstruction(`Use this template as a starting point:\n${tpl.content}`)
        }
      }}
    >
      <option value="">— pick a template —</option>
      {conciergeTemplates.map((t) => (
        <option key={t.id} value={t.id}>{t.title}</option>
      ))}
    </select>
  </div>
)}
```

Note: `setInstruction` already exists in `AIDraftPanel` as the state setter for the instruction textarea.

- [ ] **Step 8: Run full test suite**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint
```
Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add lib/agent/concierge-templates.ts app/api/settings/seed-templates/ app/settings/ConciergeTemplateSeedButton.tsx app/settings/page.tsx app/conversations/\[id\]/AIDraftPanel.tsx app/conversations/\[id\]/page.tsx tests/concierge-templates.test.ts && git commit -m "feat: local-business concierge templates with seed button and draft panel picker"
```

---

## Task 11: Update Docs and Open PR

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/CURRENT_STATE.md`

- [ ] **Step 1: Check off completed items in `docs/TODO.md`**

Find the Phase 1 remaining section and mark these as done:
- `[ ] **Smart labels taxonomy — product-complete UI** (#42)` → `[x]`
- `[ ] **Richer sensitive detection** (#10)` → `[x]`
- `[ ] **Safely-ignored reasons and bulk archive** (#25)` → `[x]`
- `[ ] **Person-memory editing and corrections** (#5)` → `[x]`
- `[ ] **Task assignment and manual task creation** (#13)` → `[x]`
- `[ ] **Trust UX** (#44)` → `[x]`
- `[ ] **Confidence policy thresholds** (#29)` → `[x]`

In the Phase 2 remaining section:
- `[ ] **Local-business concierge templates** (#36)` → `[x]`

Also add notes for command-center bills/deadline signals under #1.

- [ ] **Step 2: Update `docs/CURRENT_STATE.md`**

Add a new section after the v2.2 block describing the shipped features:

```markdown
## Phase 1 Completion + Phase 2 Final (2026-06-15)

- **Richer sensitive detection** — `lib/agent/risk-radar.ts` now exports `detectSensitiveMatches(text)` returning `{phrase, category}[]` across 7 categories (legal, immigration, tax, medical, hr, emotional, financial). Draft suggest route stores `sensitiveMatches` in draft metadata; `AIDraftPanel` shows warning chips when present.
- **Attention category correction** — `PATCH /api/conversations/[id]/attention` lets users override `attentionCategory` in ConversationState metadata; `AttentionCorrectionSelect` on the conversation page provides the UI.
- **Attention filter tabs** — inbox supports `?attention=<category>` to filter by `needs_reply`, `review_soon`, or `read_later`.
- **Safely-ignored bulk archive** — `POST /api/conversations/bulk-close` closes all quiet/FYI conversations; `BulkCloseButton` on the home view.
- **Command-center bills & deadlines** — `buildBillsSection` in `command-center.ts` surfaces upcoming tasks with due dates and `review_soon` conversations in a Bills & Deadlines card on the home view.
- **Trust UX** — Audit log shows "Why" column from `payloadJson.reason`; undo button for `autopilot.draft_approved` entries via `POST /api/audit/[id]/undo`. Personal accounts can now view audit log.
- **Per-category confidence thresholds** — `AutopilotSetting.categoryThresholdsJson` stores per-intent override thresholds; `checkAutopilotEligibility` enforces them; settings UI allows configuration.
- **Manual task creation** — `POST /api/tasks` with `source: "manual"`; `ManualTaskForm` in `WorkItemsPanel` sidebar.
- **Person-memory editing** — `PATCH /api/person-memory/[contactId]` updates summary/preferences/openQuestions/promisedActions; `PersonMemoryEditShell` wraps the edit panel in the conversation sidebar. `syncPersonMemoryWithLLM` provides LLM-based extraction via `gpt-4o-mini`.
- **Concierge templates** — `lib/agent/concierge-templates.ts` has 8 default templates; seeded as `KnowledgeDocument` with `sourceType: "concierge_template"` via `POST /api/settings/seed-templates`; picker appears in AIDraftPanel for business accounts.
```

- [ ] **Step 3: Run final verification**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && npm test && npm run lint && npm run build
```
Expected: all tests pass, no lint errors, build succeeds

- [ ] **Step 4: Commit docs**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox" && git add docs/TODO.md docs/CURRENT_STATE.md && git commit -m "docs: mark Phase 1 gaps and Phase 2 concierge templates as shipped"
```

- [ ] **Step 5: Create PR**

```bash
gh pr create \
  --title "feat: phase 1 gaps + concierge templates (v3.0-pre)" \
  --body "$(cat <<'EOF'
## Summary

- Richer sensitive detection with 7 category labels (legal, immigration, tax, medical, HR, emotional, financial) + draft highlight chips
- Attention-category correction API + dropdown on conversation page; inbox filter tabs for needs_reply / review_soon / read_later
- Command-center Bills & Deadlines section surfacing upcoming tasks and billing alerts
- Trust UX: audit log "Why" column + undo for draft approvals; personal accounts can view audit log
- Per-category autopilot confidence thresholds with settings UI (e.g. Complaint → 0.95)
- Manual task creation from conversation sidebar
- Safely-ignored bulk archive button on home view
- Person-memory editing UI + LLM-based extraction upgrade (gpt-4o-mini)
- Local-business concierge templates (8 defaults, seed button in Settings, picker in draft panel)

## Test plan

- [ ] All existing tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] New tests added for each API route and core logic function
- [ ] Smoke-check: conversation page shows sensitive chips on a risky thread
- [ ] Smoke-check: inbox `?attention=review_soon` filters correctly
- [ ] Smoke-check: bulk-close button archives FYI conversations
- [ ] Smoke-check: Settings → Concierge Templates seed button works (business account)
- [ ] Smoke-check: audit log shows "Why" column and undo on draft_approved rows

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 9 items from TODO.md are covered across Tasks 1–10.
- [x] **No placeholders:** Every step contains actual code or exact commands.
- [x] **Type consistency:** `AttentionCategory` values match `lib/agent/email-classifier.ts` exactly. `SensitiveMatch` used consistently. `BillsSection`/`BillSignal` types defined once and reused.
- [x] **Migration workflow:** Follows the no-shadow-DB pattern: `db execute` → `migrate resolve` → `generate`.
- [x] **Test mocks:** All tests use `vi.hoisted()` pattern with destructured mocks.
- [x] **Personal/business gating:** Concierge templates and LLM scoring gated on `accountType === "business"`. Attention correction and bulk close work for all accounts. Audit log personal access included.
- [x] **No new dependencies:** OpenAI is already in the project. `gpt-4o-mini` is the existing lightweight model pattern.
