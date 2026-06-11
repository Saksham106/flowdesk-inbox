# Lead Intelligence + CRM Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic lead-scoring heuristic with an LLM scorer that produces a score (1–100), a plain-language explanation, and an estimated deal value; surface this intelligence on the `/leads` CRM page and in the daily command center's opportunity cards.

**Architecture:** New `lib/ai/prompts/lead-scoring.ts` (pure prompt/normalizer, fully testable) wired through `lib/ai/openai.ts` and `lib/ai/provider.ts`. Orchestration in `lib/agent/lead-scoring.ts` handles the re-scoring guard and DB write. Sync fires it as fire-and-forget after every lead upsert. An on-demand `POST /api/leads/[id]/score` route skips the guard. UI changes are additive: funnel header and score badges on `/leads`; opportunity cards in the command center use the LLM explanation as their reason text.

**Tech Stack:** Next.js 14 App Router, Prisma, OpenAI structured output (`json_schema` format), Vitest, Tailwind CSS.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `scoreExplanation`, `estimatedValue`, `scoredAt` to `Lead` |
| `lib/ai/prompts/lead-scoring.ts` | Create | Types, JSON schema, prompt builder, output normalizer |
| `lib/ai/openai.ts` | Modify | Add `scoreLeadWithOpenAI` |
| `lib/ai/provider.ts` | Modify | Export `scoreLead` |
| `lib/agent/lead-scoring.ts` | Create | `shouldRescoreLead` guard + `scoreLeadForConversation` orchestrator |
| `lib/agent/work-item-sync.ts` | Modify | Fire-and-forget score call after lead upsert |
| `app/api/leads/[id]/score/route.ts` | Create | On-demand re-score endpoint |
| `app/leads/page.tsx` | Modify | Funnel header, score badge, explanation line, estimated value |
| `app/leads/RescoreButton.tsx` | Create | Client component for the re-score button |
| `lib/agent/command-center.ts` | Modify | Add `lead` to input type; use `scoreExplanation` as opportunity reason; expose `leadScore` on output |
| `app/inbox/page.tsx` | Modify | Include `leads` in commandCenterConversations query |
| `app/inbox/CommandCenterPanel.tsx` | Modify | Show lead score badge on opportunity cards |
| `tests/lead-scoring.test.ts` | Create | Unit tests for prompt, normalizer, guard, and orchestrator |
| `docs/MASTER_PRODUCT_PLAN.md` | Modify | Update feature #7 and #40 status; update next-slice recommendation |
| `docs/CURRENT_STATE.md` | Modify | Document new capabilities |
| `docs/TODO.md` | Modify | Check off lead scoring; update Phase 2 remaining list |

---

## Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

> **Prerequisite:** Postgres must be running locally (`localhost:5432`) before running `prisma migrate dev`.

- [ ] **Step 1: Add three fields to the Lead model**

In `prisma/schema.prisma`, inside the `model Lead { ... }` block, add these three lines after `score Int @default(0)`:

```prisma
scoreExplanation String?
estimatedValue   Int?
scoredAt         DateTime?
```

The full Lead model should look like:

```prisma
model Lead {
  id               String    @id @default(cuid())
  tenantId         String
  conversationId   String
  name             String
  company          String?
  need             String
  urgency          String    @default("medium")
  budgetClue       String?
  contactInfo      String?
  nextAction       String
  score            Int       @default(0)
  scoreExplanation String?
  estimatedValue   Int?
  scoredAt         DateTime?
  stage            String    @default("new")
  source           String    @default("deterministic")
  metadataJson     Json?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  tenant           Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversation     Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([tenantId, conversationId])
  @@index([tenantId, stage])
  @@index([tenantId, score])
}
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add_lead_scoring_fields
```

Expected: a new file appears under `prisma/migrations/` and Prisma reports the migration applied successfully.

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client`.

- [ ] **Step 4: Verify TypeScript picks up new fields**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors about `scoreExplanation`, `estimatedValue`, or `scoredAt`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add scoreExplanation, estimatedValue, scoredAt to Lead model"
```

---

## Task 2: Prompt Builder

**Files:**
- Create: `lib/ai/prompts/lead-scoring.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/ai/prompts/lead-scoring.ts

const URGENCY_LEVELS = ["low", "medium", "high"] as const
export type LeadScoringUrgency = (typeof URGENCY_LEVELS)[number]

export type LeadScoringResult = {
  score: number
  scoreExplanation: string
  estimatedValue: number | null
  need: string
  urgency: LeadScoringUrgency
  budgetClue: string | null
  model: string
}

export type LeadScoringPromptInput = {
  messages: Array<{
    direction: string
    body: string
    createdAt: Date | string
  }>
  existingNeed?: string | null
  existingUrgency?: string | null
  existingBudgetClue?: string | null
}

export const leadScoringJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "scoreExplanation", "estimatedValue", "need", "urgency", "budgetClue"],
  properties: {
    score: { type: "number" },
    scoreExplanation: { type: "string" },
    estimatedValue: { anyOf: [{ type: "number" }, { type: "null" }] },
    need: { type: "string" },
    urgency: { type: "string", enum: ["low", "medium", "high"] },
    budgetClue: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
}

export function buildLeadScoringPrompt(input: LeadScoringPromptInput): string {
  const messages = input.messages
    .slice(-20)
    .map((m) => {
      const at = m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt
      return `${at} ${m.direction.toUpperCase()}: ${truncate(m.body, 300)}`
    })
    .join("\n")

  const contextLines = [
    input.existingNeed ? `Previously extracted need: ${input.existingNeed}` : null,
    input.existingUrgency ? `Previously extracted urgency: ${input.existingUrgency}` : null,
    input.existingBudgetClue ? `Previously extracted budget clue: ${input.existingBudgetClue}` : null,
  ].filter((line): line is string => line !== null)

  return [
    "You are FlowDesk's lead intelligence engine. Score the sales potential of this email thread.",
    "OUTBOUND messages were sent by the business owner; INBOUND messages were sent by the potential customer.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    "Scoring rubric:",
    "80-100: Explicit intent — demo request, 'ready to move forward', specific pricing ask with timeline, named budget.",
    "60-79:  Moderate intent — qualifying question, named use case, budget range mentioned, urgency signals.",
    "40-59:  Early interest — vague inquiry, 'just looking', no urgency, no budget signals.",
    "1-39:   Weak signal — generic question, unlikely buyer, FYI context only.",
    "",
    "Field guidance:",
    "- score: integer 1-100 based on the rubric above.",
    "- scoreExplanation: 1-2 sentences explaining what signals drove the score. Be specific.",
    "- estimatedValue: rough dollar value of the deal if it closes, or null if there are no value signals.",
    "- need: 1 sentence describing what the person is looking for.",
    "- urgency: low / medium / high based on timeline signals in the thread.",
    "- budgetClue: any budget signal as a short string, or null if none.",
    "",
    "Safety rules:",
    "- Do not invent facts not present in the thread.",
    "- Do not treat FYI emails or newsletters as leads.",
    ...(contextLines.length > 0 ? ["", ...contextLines] : []),
    "",
    "Thread (oldest first):",
    messages,
  ].join("\n")
}

export function normalizeLeadScoringOutput(rawText: string, model: string): LeadScoringResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("AI response was not valid JSON")
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AI response was not an object")
  }

  const record = parsed as Record<string, unknown>

  const rawScore = typeof record.score === "number" ? record.score : 0
  const score = Math.max(1, Math.min(100, Math.round(rawScore)))

  const scoreExplanation = asTrimmedString(record.scoreExplanation)
  if (!scoreExplanation) throw new Error("AI response did not include scoreExplanation")

  const estimatedValue =
    typeof record.estimatedValue === "number" && record.estimatedValue > 0
      ? Math.round(record.estimatedValue)
      : null

  const urgency: LeadScoringUrgency = URGENCY_LEVELS.includes(record.urgency as LeadScoringUrgency)
    ? (record.urgency as LeadScoringUrgency)
    : "medium"

  return {
    score,
    scoreExplanation,
    estimatedValue,
    need: asTrimmedString(record.need) || "Expressed interest in the product or service.",
    urgency,
    budgetClue: asTrimmedString(record.budgetClue) || null,
    model,
  }
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep "lead-scoring"
```

Expected: no output (no errors).

---

## Task 3: Tests for Prompt Builder and Normalizer

**Files:**
- Create: `tests/lead-scoring.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// tests/lead-scoring.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildLeadScoringPrompt,
  normalizeLeadScoringOutput,
} from '@/lib/ai/prompts/lead-scoring'

const HIGH_INTENT_MESSAGES = [
  {
    direction: 'inbound',
    body: "Hi, we're evaluating vendors for AI reception at our dental clinic. We have a $2k/month budget. Can we book a demo this week?",
    createdAt: new Date('2026-06-09T10:00:00Z'),
  },
  {
    direction: 'outbound',
    body: "Absolutely! I'd love to show you the product. Are you free Thursday at 2pm?",
    createdAt: new Date('2026-06-09T11:00:00Z'),
  },
]

const WEAK_SIGNAL_MESSAGES = [
  {
    direction: 'inbound',
    body: 'Do you do dental stuff?',
    createdAt: new Date('2026-06-09T10:00:00Z'),
  },
]

// ---------------------------------------------------------------------------
// buildLeadScoringPrompt
// ---------------------------------------------------------------------------

describe('buildLeadScoringPrompt', () => {
  it('includes messages with direction labels', () => {
    const prompt = buildLeadScoringPrompt({ messages: HIGH_INTENT_MESSAGES })
    expect(prompt).toContain('INBOUND:')
    expect(prompt).toContain('OUTBOUND:')
    expect(prompt).toContain('dental clinic')
  })

  it('includes scoring rubric', () => {
    const prompt = buildLeadScoringPrompt({ messages: HIGH_INTENT_MESSAGES })
    expect(prompt).toContain('80-100')
    expect(prompt).toContain('Explicit intent')
  })

  it('includes existing context fields when provided', () => {
    const prompt = buildLeadScoringPrompt({
      messages: HIGH_INTENT_MESSAGES,
      existingNeed: 'AI receptionist',
      existingUrgency: 'high',
      existingBudgetClue: '$2k/month',
    })
    expect(prompt).toContain('Previously extracted need: AI receptionist')
    expect(prompt).toContain('Previously extracted urgency: high')
    expect(prompt).toContain('Previously extracted budget clue: $2k/month')
  })

  it('omits context section when no existing fields are provided', () => {
    const prompt = buildLeadScoringPrompt({ messages: WEAK_SIGNAL_MESSAGES })
    expect(prompt).not.toContain('Previously extracted')
  })

  it('keeps only the most recent 20 messages', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      direction: 'inbound',
      body: `message-number-${i}`,
      createdAt: new Date(),
    }))
    const prompt = buildLeadScoringPrompt({ messages: many })
    expect(prompt).toContain('message-number-24')
    expect(prompt).not.toContain('message-number-4')
  })

  it('truncates long message bodies to 300 chars', () => {
    const prompt = buildLeadScoringPrompt({
      messages: [{ direction: 'inbound', body: 'x'.repeat(500), createdAt: new Date() }],
    })
    expect(prompt).not.toContain('x'.repeat(310))
    expect(prompt).toContain('...')
  })
})

// ---------------------------------------------------------------------------
// normalizeLeadScoringOutput
// ---------------------------------------------------------------------------

describe('normalizeLeadScoringOutput', () => {
  it('returns a valid result from a well-formed response', () => {
    const raw = JSON.stringify({
      score: 85,
      scoreExplanation: 'High-intent lead with budget and demo request.',
      estimatedValue: 2000,
      need: 'AI receptionist for dental clinic',
      urgency: 'high',
      budgetClue: '$2k/month',
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.score).toBe(85)
    expect(result.scoreExplanation).toBe('High-intent lead with budget and demo request.')
    expect(result.estimatedValue).toBe(2000)
    expect(result.urgency).toBe('high')
    expect(result.budgetClue).toBe('$2k/month')
    expect(result.model).toBe('gpt-5.4-mini')
  })

  it('clamps score to 1–100', () => {
    const raw = JSON.stringify({
      score: 150,
      scoreExplanation: 'Over the limit.',
      estimatedValue: null,
      need: 'test',
      urgency: 'medium',
      budgetClue: null,
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.score).toBe(100)
  })

  it('clamps score minimum to 1', () => {
    const raw = JSON.stringify({
      score: -5,
      scoreExplanation: 'Very weak signal.',
      estimatedValue: null,
      need: 'test',
      urgency: 'low',
      budgetClue: null,
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.score).toBe(1)
  })

  it('returns null estimatedValue when value is 0 or null', () => {
    const raw = JSON.stringify({
      score: 30,
      scoreExplanation: 'Weak signal.',
      estimatedValue: 0,
      need: 'test',
      urgency: 'low',
      budgetClue: null,
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.estimatedValue).toBeNull()
  })

  it('falls back to "medium" urgency for unknown values', () => {
    const raw = JSON.stringify({
      score: 50,
      scoreExplanation: 'Some interest.',
      estimatedValue: null,
      need: 'test',
      urgency: 'unknown-value',
      budgetClue: null,
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.urgency).toBe('medium')
  })

  it('throws on invalid JSON', () => {
    expect(() => normalizeLeadScoringOutput('not json', 'gpt-5.4-mini')).toThrow(
      'AI response was not valid JSON'
    )
  })

  it('throws when scoreExplanation is missing', () => {
    const raw = JSON.stringify({ score: 50, estimatedValue: null, need: 'test', urgency: 'low', budgetClue: null })
    expect(() => normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')).toThrow(
      'AI response did not include scoreExplanation'
    )
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run tests/lead-scoring.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts/lead-scoring.ts tests/lead-scoring.test.ts
git commit -m "feat: add lead scoring prompt builder and normalizer with tests"
```

---

## Task 4: OpenAI + Provider Wiring

**Files:**
- Modify: `lib/ai/openai.ts`
- Modify: `lib/ai/provider.ts`

- [ ] **Step 1: Add import to `lib/ai/openai.ts`**

At the top of `lib/ai/openai.ts`, add to the existing imports from `@/lib/ai/prompts/`:

```typescript
import {
  buildLeadScoringPrompt,
  leadScoringJsonSchema,
  normalizeLeadScoringOutput,
} from "@/lib/ai/prompts/lead-scoring"
import type { LeadScoringPromptInput, LeadScoringResult } from "@/lib/ai/prompts/lead-scoring"
```

- [ ] **Step 2: Add `scoreLeadWithOpenAI` function to `lib/ai/openai.ts`**

Add this function after the `explainThreadWithOpenAI` function:

```typescript
export async function scoreLeadWithOpenAI(
  input: LeadScoringPromptInput
): Promise<LeadScoringResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const client = new OpenAI({ apiKey })
  const prompt = buildLeadScoringPrompt(input)

  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "flowdesk_lead_scoring",
        strict: true,
        schema: leadScoringJsonSchema,
      },
    },
  })

  return normalizeLeadScoringOutput(response.output_text, model)
}
```

- [ ] **Step 3: Add `scoreLead` to `lib/ai/provider.ts`**

Add the import and export to `lib/ai/provider.ts`:

```typescript
import { scoreLeadWithOpenAI } from "@/lib/ai/openai"
import type { LeadScoringPromptInput, LeadScoringResult } from "@/lib/ai/prompts/lead-scoring"

export async function scoreLead(input: LeadScoringPromptInput): Promise<LeadScoringResult> {
  return scoreLeadWithOpenAI(input)
}
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep -E "openai|provider" | head -10
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/openai.ts lib/ai/provider.ts
git commit -m "feat: wire lead scoring through OpenAI provider"
```

---

## Task 5: Orchestration — `lib/agent/lead-scoring.ts`

**Files:**
- Create: `lib/agent/lead-scoring.ts`

- [ ] **Step 1: Create the orchestration module**

```typescript
// lib/agent/lead-scoring.ts
import { prisma } from "@/lib/prisma"
import { scoreLead } from "@/lib/ai/provider"
import type { LeadScoringPromptInput } from "@/lib/ai/prompts/lead-scoring"

export function shouldRescoreLead(
  scoredAt: Date | null,
  conversationUpdatedAt: Date
): boolean {
  if (!scoredAt) return true
  return conversationUpdatedAt > scoredAt
}

export async function scoreLeadForConversation(
  tenantId: string,
  leadId: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      conversation: {
        include: {
          messages: { orderBy: { createdAt: "asc" }, take: 20 },
        },
      },
    },
  })

  if (!lead || !lead.conversation) return

  if (!options.force && !shouldRescoreLead(lead.scoredAt, lead.conversation.updatedAt)) return

  const input: LeadScoringPromptInput = {
    messages: lead.conversation.messages,
    existingNeed: lead.need,
    existingUrgency: lead.urgency,
    existingBudgetClue: lead.budgetClue,
  }

  let result: Awaited<ReturnType<typeof scoreLead>>
  try {
    result = await scoreLead(input)
  } catch {
    // Leave existing heuristic score intact on LLM failure
    return
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      score: result.score,
      scoreExplanation: result.scoreExplanation,
      estimatedValue: result.estimatedValue,
      scoredAt: new Date(),
      need: result.need,
      urgency: result.urgency,
      budgetClue: result.budgetClue ?? lead.budgetClue,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "lead.scored",
      payloadJson: {
        leadId,
        score: result.score,
        source: "llm",
        model: result.model,
      },
    },
  })
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep "lead-scoring" | head -10
```

Expected: no output.

---

## Task 6: Tests for Orchestration

**Files:**
- Modify: `tests/lead-scoring.test.ts`

- [ ] **Step 1: Add hoisted mocks and orchestration tests to `tests/lead-scoring.test.ts`**

Add the following at the top of the file (before the existing imports), then add the describe block at the end:

**At the very top of the file, before any imports:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks (must come before any module imports that use them)
// ---------------------------------------------------------------------------
const {
  mockLeadFindFirst,
  mockLeadUpdate,
  mockAuditCreate,
  mockScoreLead,
} = vi.hoisted(() => ({
  mockLeadFindFirst: vi.fn(),
  mockLeadUpdate:    vi.fn(),
  mockAuditCreate:   vi.fn(),
  mockScoreLead:     vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead:     { findFirst: mockLeadFindFirst, update: mockLeadUpdate },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock('@/lib/ai/provider', () => ({
  scoreLead: mockScoreLead,
}))
```

**Remove the existing `import { describe, it, expect, vi, beforeEach } from 'vitest'` line** since it's now at the top.

**Add at the end of the file:**

```typescript
// ---------------------------------------------------------------------------
// shouldRescoreLead
// ---------------------------------------------------------------------------

import { shouldRescoreLead, scoreLeadForConversation } from '@/lib/agent/lead-scoring'

describe('shouldRescoreLead', () => {
  it('returns true when scoredAt is null', () => {
    expect(shouldRescoreLead(null, new Date())).toBe(true)
  })

  it('returns true when conversation was updated after scoring', () => {
    const scoredAt = new Date('2026-06-10T10:00:00Z')
    const updatedAt = new Date('2026-06-11T12:00:00Z')
    expect(shouldRescoreLead(scoredAt, updatedAt)).toBe(true)
  })

  it('returns false when conversation was not updated since scoring', () => {
    const scoredAt = new Date('2026-06-11T12:00:00Z')
    const updatedAt = new Date('2026-06-10T10:00:00Z')
    expect(shouldRescoreLead(scoredAt, updatedAt)).toBe(false)
  })

  it('returns false when scoredAt equals conversationUpdatedAt', () => {
    const ts = new Date('2026-06-11T12:00:00Z')
    expect(shouldRescoreLead(ts, ts)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// scoreLeadForConversation
// ---------------------------------------------------------------------------

describe('scoreLeadForConversation', () => {
  const TENANT = 'tenant-1'
  const LEAD_ID = 'lead-1'
  const NOW = new Date('2026-06-11T12:00:00Z')
  const YESTERDAY = new Date('2026-06-10T12:00:00Z')

  const MOCK_LEAD = {
    id: LEAD_ID,
    tenantId: TENANT,
    need: 'AI receptionist',
    urgency: 'medium',
    budgetClue: null,
    scoredAt: null,
    conversation: {
      updatedAt: NOW,
      messages: [
        { direction: 'inbound', body: 'Do you offer dental AI?', createdAt: NOW },
      ],
    },
  }

  const MOCK_RESULT = {
    score: 82,
    scoreExplanation: 'Demo request with named budget.',
    estimatedValue: 2000,
    need: 'AI receptionist for dental clinic',
    urgency: 'high' as const,
    budgetClue: '$2k/month',
    model: 'gpt-5.4-mini',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockLeadFindFirst.mockResolvedValue(MOCK_LEAD)
    mockScoreLead.mockResolvedValue(MOCK_RESULT)
    mockLeadUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
  })

  it('calls scoreLead and updates the lead when scoredAt is null', async () => {
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockScoreLead).toHaveBeenCalledOnce()
    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: LEAD_ID },
      data: expect.objectContaining({
        score: 82,
        scoreExplanation: 'Demo request with named budget.',
        estimatedValue: 2000,
      }),
    })
  })

  it('skips scoring when conversation has not changed since last score', async () => {
    mockLeadFindFirst.mockResolvedValue({
      ...MOCK_LEAD,
      scoredAt: NOW,
      conversation: { ...MOCK_LEAD.conversation, updatedAt: YESTERDAY },
    })
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockScoreLead).not.toHaveBeenCalled()
    expect(mockLeadUpdate).not.toHaveBeenCalled()
  })

  it('force option bypasses the re-scoring guard', async () => {
    mockLeadFindFirst.mockResolvedValue({
      ...MOCK_LEAD,
      scoredAt: NOW,
      conversation: { ...MOCK_LEAD.conversation, updatedAt: YESTERDAY },
    })
    await scoreLeadForConversation(TENANT, LEAD_ID, { force: true })
    expect(mockScoreLead).toHaveBeenCalledOnce()
  })

  it('does not update the lead if scoreLead throws', async () => {
    mockScoreLead.mockRejectedValue(new Error('OpenAI error'))
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockLeadUpdate).not.toHaveBeenCalled()
  })

  it('returns immediately when the lead is not found', async () => {
    mockLeadFindFirst.mockResolvedValue(null)
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockScoreLead).not.toHaveBeenCalled()
  })

  it('writes an audit log entry on success', async () => {
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        action: 'lead.scored',
      }),
    })
  })
})
```

- [ ] **Step 2: Run the full test file**

```bash
npx vitest run tests/lead-scoring.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/lead-scoring.ts tests/lead-scoring.test.ts
git commit -m "feat: add lead scoring orchestrator with re-scoring guard and tests"
```

---

## Task 7: Wire into Work-Item Sync

**Files:**
- Modify: `lib/agent/work-item-sync.ts`

- [ ] **Step 1: Add import at the top of `lib/agent/work-item-sync.ts`**

Add this import alongside the existing imports:

```typescript
import { scoreLeadForConversation } from "@/lib/agent/lead-scoring"
```

- [ ] **Step 2: Add fire-and-forget call after `leadSynced = true`**

Find the block that sets `leadSynced = true` (after the `prisma.auditLog.create` call for `lead.synced`). Add the fire-and-forget call immediately after `leadSynced = true`:

```typescript
leadSynced = true

// Fire-and-forget LLM scoring — does not block sync
const upsertedLead = await prisma.lead.findFirst({
  where: { tenantId: conversation.tenantId, conversationId: conversation.id },
  select: { id: true },
})
if (upsertedLead) {
  void scoreLeadForConversation(conversation.tenantId, upsertedLead.id).catch(() => {
    // Scoring failures are silent — the heuristic score remains
  })
}
```

- [ ] **Step 3: Verify tests still pass**

```bash
npx vitest run
```

Expected: all existing tests pass (same count as before this task).

- [ ] **Step 4: Commit**

```bash
git add lib/agent/work-item-sync.ts
git commit -m "feat: trigger LLM lead scoring fire-and-forget after work-item sync"
```

---

## Task 8: On-Demand Score API Route

**Files:**
- Create: `app/api/leads/[id]/score/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// app/api/leads/[id]/score/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { scoreLeadForConversation } from "@/lib/agent/lead-scoring"

export const runtime = "nodejs"

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const lead = await prisma.lead.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true },
  })

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  await scoreLeadForConversation(session.user.tenantId, lead.id, { force: true })

  const updated = await prisma.lead.findFirst({
    where: { id: lead.id },
    select: { score: true, scoreExplanation: true, estimatedValue: true, scoredAt: true },
  })

  return NextResponse.json(updated)
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep "leads" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app/api/leads/[id]/score/route.ts
git commit -m "feat: add POST /api/leads/[id]/score on-demand re-score endpoint"
```

---

## Task 9: Re-Score Button Client Component

**Files:**
- Create: `app/leads/RescoreButton.tsx`

- [ ] **Step 1: Create the client component**

```typescript
// app/leads/RescoreButton.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export function RescoreButton({ leadId }: { leadId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleRescore() {
    setLoading(true)
    try {
      await fetch(`/api/leads/${leadId}/score`, { method: "POST" })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleRescore}
      disabled={loading}
      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
      title="Re-score with AI"
      aria-label="Re-score lead"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={loading ? "animate-spin" : ""}
      >
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    </button>
  )
}
```

---

## Task 10: `/leads` Page UI Upgrades

**Files:**
- Modify: `app/leads/page.tsx`

- [ ] **Step 1: Replace the full `app/leads/page.tsx`**

```typescript
import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { LEAD_SEQUENCE_STEPS, readSequenceState } from "@/lib/agent/lead-sequence"
import { RescoreButton } from "@/app/leads/RescoreButton"

export const dynamic = "force-dynamic"

const STAGE_COLORS: Record<string, string> = {
  new: "bg-slate-100 text-slate-600",
  contacted: "bg-blue-100 text-blue-700",
  qualified: "bg-violet-100 text-violet-700",
  won: "bg-emerald-100 text-emerald-700",
  lost: "bg-red-100 text-red-600",
}

const URGENCY_COLORS: Record<string, string> = {
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-slate-500",
}

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "bg-emerald-100 text-emerald-700"
  if (score >= 40) return "bg-amber-100 text-amber-700"
  return "bg-slate-100 text-slate-500"
}

const PIPELINE_STAGES = ["new", "contacted", "qualified"] as const

export default async function LeadsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { accountType: true },
  })
  if (tenant?.accountType === "personal") redirect("/inbox")

  const leads = await prisma.lead.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { score: "desc" },
    include: {
      conversation: {
        include: { contact: true },
      },
    },
    take: 200,
  })

  const activeLeads = leads.filter((l) => l.stage !== "won" && l.stage !== "lost")
  const closedLeads = leads.filter((l) => l.stage === "won" || l.stage === "lost")

  const funnel = PIPELINE_STAGES.map((stage) => {
    const stageLeads = leads.filter((l) => l.stage === stage)
    const totalValue = stageLeads.reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0)
    return { stage, count: stageLeads.length, totalValue }
  })

  function FunnelHeader() {
    return (
      <div className="mb-6 flex flex-wrap gap-3">
        {funnel.map(({ stage, count, totalValue }) => (
          <div
            key={stage}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STAGE_COLORS[stage] ?? "bg-slate-100 text-slate-600"}`}
            >
              {stage}
            </span>
            <span className="text-sm font-semibold text-slate-900">{count}</span>
            {totalValue > 0 && (
              <span className="text-xs text-slate-500">
                ~${totalValue.toLocaleString()}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  function LeadRow({ lead }: { lead: (typeof leads)[number] }) {
    const stageColor = STAGE_COLORS[lead.stage] ?? "bg-slate-100 text-slate-600"
    const urgencyColor = URGENCY_COLORS[lead.urgency] ?? "text-slate-500"
    const sequence = readSequenceState(lead.metadataJson)
    const badgeClass = scoreBadgeClass(lead.score)

    return (
      <li className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">
              {lead.company ?? lead.name}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${stageColor}`}
            >
              {lead.stage}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{lead.need}</p>
          {lead.scoreExplanation ? (
            <p className="mt-0.5 text-xs text-slate-500 italic">{lead.scoreExplanation}</p>
          ) : lead.budgetClue ? (
            <p className="mt-0.5 text-xs text-slate-500">{lead.budgetClue}</p>
          ) : null}
          <div className="mt-1 flex items-center gap-2">
            <p className={`text-xs font-medium capitalize ${urgencyColor}`}>
              {lead.urgency} urgency
            </p>
            {lead.estimatedValue ? (
              <span className="text-xs text-slate-400">
                · ~${lead.estimatedValue.toLocaleString()} est.
              </span>
            ) : null}
          </div>
          {sequence.lastStep > 0 ? (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Follow-up {sequence.lastStep} of {LEAD_SEQUENCE_STEPS.length} queued
              {sequence.lastStepAt
                ? ` · ${sequence.lastStepAt.toLocaleDateString()}`
                : ""}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
              {lead.score}
            </span>
            <RescoreButton leadId={lead.id} />
          </div>
          <Link
            href={`/conversations/${lead.conversationId}`}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            View →
          </Link>
        </div>
      </li>
    )
  }

  function Section({
    title,
    items,
    emptyText,
  }: {
    title: string
    items: typeof leads
    emptyText: string
  }) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
        {items.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
            {emptyText}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {items.map((lead) => (
                <LeadRow key={lead.id} lead={lead} />
              ))}
            </ul>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Leads</h1>
            <p className="text-sm text-slate-500">
              {activeLeads.length} active lead{activeLeads.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {activeLeads.length > 0 && <FunnelHeader />}
        <Section
          title="Active pipeline"
          items={activeLeads}
          emptyText="No active leads yet. Leads are detected automatically when conversations contain pricing, demo, or booking signals."
        />
        <Section
          title="Closed"
          items={closedLeads}
          emptyText="No closed leads."
        />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep "leads/page" | head -10
```

Expected: no output.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: same pass count as before.

- [ ] **Step 4: Commit**

```bash
git add app/leads/page.tsx app/leads/RescoreButton.tsx
git commit -m "feat: add funnel header, LLM score badge, and re-score button to /leads page"
```

---

## Task 11: Command Center Lead Score Integration

**Files:**
- Modify: `lib/agent/command-center.ts`
- Modify: `app/inbox/page.tsx`
- Modify: `app/inbox/CommandCenterPanel.tsx`

- [ ] **Step 1: Add `lead` field to `CommandCenterInputConversation` in `lib/agent/command-center.ts`**

Find the `CommandCenterInputConversation` type definition and add the optional `lead` field:

```typescript
export type CommandCenterInputConversation = {
  // ... existing fields ...
  lead?: {
    score: number
    scoreExplanation: string | null
  } | null
}
```

- [ ] **Step 2: Add `leadScore` to `CommandCenterConversation` in `lib/agent/command-center.ts`**

Find the `CommandCenterConversation` type definition (around line 55) and add:

```typescript
export type CommandCenterConversation = {
  // ... existing fields ...
  leadScore: number | null
}
```

- [ ] **Step 3: Update `analyzeConversationForCommandCenter` to use lead explanation**

Find the section (around line 229) where `opportunity` is detected and `reason` is set:

```typescript
} else if (opportunity) {
  state = "opportunity"
  reason = "Potential revenue or booking opportunity."
  nextAction = "Draft a reply and move the opportunity forward."
}
```

Replace it with:

```typescript
} else if (opportunity) {
  state = "opportunity"
  reason = conversation.lead?.scoreExplanation ?? "Potential revenue or booking opportunity."
  nextAction = "Draft a reply and move the opportunity forward."
}
```

- [ ] **Step 4: Propagate `leadScore` through `analyzeConversationForCommandCenter`**

Find where the function returns (around line 260, where the `CommandCenterConversation` object is built). Add `leadScore` to the return object:

```typescript
return {
  // ... existing fields ...
  leadScore: opportunity && conversation.lead ? conversation.lead.score : null,
}
```

- [ ] **Step 5: Include `leads` in the command center query in `app/inbox/page.tsx`**

Find the `commandCenterConversations` query in `app/inbox/page.tsx` (the `prisma.conversation.findMany` that takes 75 conversations for the command center). Add `leads` to its include:

```typescript
prisma.conversation.findMany({
  where: { tenantId },
  orderBy: { lastMessageAt: "desc" },
  take: 75,
  include: {
    messages: { orderBy: { createdAt: "asc" }, take: 20 },
    channel: true,
    contact: true,
    draft: true,
    agentJobs: { orderBy: { createdAt: "desc" }, take: 3 },
    approvalRequests: {
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 3,
    },
    calendarHolds: {
      where: { status: "held" },
      orderBy: { expiresAt: "asc" },
      take: 3,
    },
    leads: {
      select: { score: true, scoreExplanation: true },
      take: 1,
    },
  },
}),
```

- [ ] **Step 6: Map the lead into the `CommandCenterInputConversation` shape**

In `app/inbox/page.tsx`, find where `commandCenterConversations` is passed to `buildDailyCommandCenter`. The conversations from Prisma have a `leads` array (since a conversation has at most one lead due to the unique constraint, `take: 1` is safe). Map it:

Find the line:
```typescript
const commandCenter = buildDailyCommandCenter(commandCenterConversations)
```

Replace it with:

```typescript
const commandCenter = buildDailyCommandCenter(
  commandCenterConversations.map((c) => ({
    ...c,
    lead: c.leads[0] ?? null,
  }))
)
```

- [ ] **Step 7: Show lead score badge on opportunity cards in `CommandCenterPanel.tsx`**

Find the `topActions` list rendering in `CommandCenterPanel.tsx`. The current card shows a priority badge. Add a score badge when `item.leadScore` is non-null:

Find:
```tsx
<span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">
  {item.priority}
</span>
```

Replace with:

```tsx
<div className="flex shrink-0 flex-col items-end gap-1">
  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">
    {item.priority}
  </span>
  {item.leadScore !== null && item.leadScore !== undefined ? (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        item.leadScore >= 70
          ? "bg-emerald-100 text-emerald-700"
          : item.leadScore >= 40
            ? "bg-amber-100 text-amber-700"
            : "bg-slate-100 text-slate-500"
      }`}
    >
      {item.leadScore}
    </span>
  ) : null}
</div>
```

- [ ] **Step 8: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 9: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/agent/command-center.ts app/inbox/page.tsx app/inbox/CommandCenterPanel.tsx
git commit -m "feat: use LLM lead score and explanation in command center opportunity cards"
```

---

## Task 12: Docs Update

**Files:**
- Modify: `docs/MASTER_PRODUCT_PLAN.md`
- Modify: `docs/CURRENT_STATE.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1: Update feature index in `docs/MASTER_PRODUCT_PLAN.md`**

Find the feature index table rows for features #7 and #40, and update their status from `Partial` to `Partial` (already partial, now more complete). Update the Notes column:

| # | Feature | Status | Notes |
|---|---|---|---|
| 7 | Business Lead Capture From Email | `Partial` | LLM-based scoring, scoreExplanation, estimatedValue, and funnel header shipped. CRM filter/search and value forecasting remain. |
| 40 | Email Triage By Money Impact | `Partial` | Lead score explanation surfaces in command center opportunity cards. Full money-impact ranking TBD. |

Also add a decision-log entry:

```
| 2026-06-11 | Ship lead intelligence slice: LLM scorer + CRM funnel header + command center score badge. | Lead model already existed; LLM replaces heuristic; next slice is KB replies + customer support mode. |
```

Update the "Suggested next Phase 2 slice" section to point to KB replies + customer support mode.

- [ ] **Step 2: Update `docs/CURRENT_STATE.md`**

Add a new section after the meeting prep slice:

```markdown
### Lead Intelligence + CRM Pipeline Slice

Shipped (2026-06-11):

- `lib/ai/prompts/lead-scoring.ts` — prompt builder, JSON schema, and output normalizer for LLM-based scoring.
- `lib/agent/lead-scoring.ts` — `shouldRescoreLead` guard and `scoreLeadForConversation` orchestrator; writes `score`, `scoreExplanation`, `estimatedValue`, `scoredAt` back to the Lead record.
- `lib/agent/work-item-sync.ts` — fires `scoreLeadForConversation` as fire-and-forget after every lead upsert.
- `POST /api/leads/[id]/score` — on-demand re-score endpoint with `force: true`.
- `/leads` page — funnel header with per-stage counts and estimated value; color-coded score badge (green/amber/gray); `scoreExplanation` shown as subtitle; `estimatedValue` shown inline; re-score button.
- Command center — opportunity cards use `lead.scoreExplanation` as the reason text; lead score badge shown on high-intent opportunities.

Current behavior:

- LLM scoring runs automatically after each sync when the conversation has changed since the last score.
- The deterministic heuristic score is preserved as fallback if LLM scoring fails.
- Existing tests: `tests/lead-scoring.test.ts`.

Limitations:

- Batch re-scoring of all existing leads is not yet implemented.
- CRM filter/search by score is not yet implemented.
- Full value forecasting and pipeline trend analytics are not yet implemented.
```

- [ ] **Step 3: Update `docs/TODO.md`**

Check off lead scoring refinement and update the Phase 2 remaining list:

```markdown
- [x] **Lead scoring refinement** (#7) — shipped 2026-06-11: LLM-based scorer replacing heuristic; `scoreExplanation`, `estimatedValue`, `scoredAt` fields; fire-and-forget sync integration; on-demand re-score API; funnel header + score badge on `/leads`; command center opportunity cards use LLM explanation.
```

Also update meeting prep and post-meeting follow-up entries (both were shipped in the first Phase 2 slice but still appear unchecked):

```markdown
- [x] **Meeting prep from email history** (#11) — shipped 2026-06-11: `/meetings` page with on-demand brief from PersonMemory + email threads.
- [x] **Post-meeting follow-up generator** (#12) — shipped 2026-06-11: notes + prior threads → follow-up draft → ApprovalRequest.
```

- [ ] **Step 4: Run final verification**

```bash
npx vitest run && npx tsc --noEmit && npx next build 2>&1 | tail -10
```

Expected:
- Vitest: all tests pass.
- TypeScript: no errors.
- Next.js build: succeeds (or reports only expected warnings, not errors).

- [ ] **Step 5: Commit**

```bash
git add docs/MASTER_PRODUCT_PLAN.md docs/CURRENT_STATE.md docs/TODO.md
git commit -m "docs: update master plan, current state, and TODO for lead intelligence slice"
```
