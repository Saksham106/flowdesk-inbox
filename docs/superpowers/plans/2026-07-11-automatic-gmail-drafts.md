# Automatic Gmail Draft Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Level 3+ automatic Gmail draft creation actually automatic (today it requires a manual web-app click), gate it behind a cheap eligibility check so newsletters/announcements don't get drafted, add a one-time backfill flow when a tenant raises their level, and sanitize every draft (manual, automatic, backfilled, and autopilot's auto-send) through one shared choke point.

**Architecture:** Extract the draft-generation sequence (context → prompt → generate → sanitize → persist → queue Gmail writeback) out of the manual API route into a shared `proposeDraftForConversation()` function in a new `lib/agent/draft-generation.ts`. Three callers use it: the existing manual route (unchanged behavior), a new automatic hook in `work-item-sync.ts` (runs on every Gmail/Outlook sync), and a new backfill endpoint. A new eligibility gate (`lib/agent/draft-eligibility.ts`) runs inside that shared function for the automatic/backfill sources only, using a deterministic check first and a cheap LLM call only when still ambiguous. A new sanitizer (`lib/agent/draft-sanitizer.ts`) runs for all four paths including autopilot's separate auto-send flow.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma/PostgreSQL, Vitest, existing `runAiJsonFeature` AI gateway (OpenRouter).

## Global Constraints

- Test runner is Vitest: `npx vitest run <file>` — never Jest.
- Required before any commit that touches app code: the new/changed test file must pass.
- Follow existing mocking convention: `vi.hoisted()` + `vi.mock("@/lib/prisma")`, see `tests/gmail-drafts.test.ts`.
- No new Prisma schema/migration — every new piece of state lives in existing `metadataJson` fields, matching the codebase's established pattern (`autoSendEligible`, `autoSendHoldReason`, etc. in `Draft.metadataJson`).
- The eligibility gate only ever runs for `source: "automatic"` and `source: "backfill"` — manual (`source: "manual"`, i.e. the user explicitly clicked "AI Draft") always generates, per the approved spec.
- The gate only activates when `classification.emailType === "needs_reply" && classification.confidence <= 0.7` (the deterministic classifier's generic fallback, `lib/agent/email-classifier.ts:474`) — this is the only branch that returns exactly `0.7`. All other classifications skip the gate with zero added cost.

---

## File Structure

New files:
- `lib/agent/draft-sanitizer.ts` — pure text-sanitization function, no I/O.
- `lib/agent/draft-eligibility.ts` — deterministic bulk-mail check + orchestration of the AI gate + retag persistence.
- `lib/ai/prompts/draft-eligibility.ts` — prompt builder + JSON schema for the AI eligibility check (mirrors `lib/ai/prompts/draft-reply.ts`'s structure).
- `lib/agent/draft-generation.ts` — `proposeDraftForConversation()`, the extracted shared draft pipeline.
- `app/api/autopilot-settings/backfill-drafts/route.ts` — new POST endpoint for bulk backfill.

Modified files:
- `lib/agent/email-classifier.ts` — export `BULK_LIST_PATTERN` (already defined internally at line ~150) so the eligibility gate can reuse the exact same regex instead of duplicating it.
- `app/api/conversations/[id]/draft/suggest/route.ts` — slimmed to call `proposeDraftForConversation({ source: "manual" })`.
- `lib/agent/work-item-sync.ts` — new automatic-trigger block after the existing classification/label-projection section.
- `lib/agent/autopilot.ts` — `attemptAutopilotSend` runs the sanitizer before deciding to auto-send vs. fall back to `proposed`.
- `app/api/autopilot-settings/route.ts` — PATCH response includes `backfillAvailable`/`backfillEligibleCount` when a level change crosses the 3-threshold upward.
- `app/settings/AutopilotSettingsForm.tsx` — one-time backfill banner after a qualifying level change.

---

### Task 1: Draft sanitizer

**Files:**
- Create: `lib/agent/draft-sanitizer.ts`
- Test: `tests/draft-sanitizer.test.ts`

**Interfaces:**
- Produces: `sanitizeDraftText(text: string): { text: string; autoFixed: string[]; flagged: string[] }` — pure function, no I/O. Later tasks (`draft-generation.ts`, `autopilot.ts`) call this directly.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/draft-sanitizer.test.ts
import { describe, expect, it } from "vitest"
import { sanitizeDraftText } from "@/lib/agent/draft-sanitizer"

describe("sanitizeDraftText", () => {
  it("strips quoted-thread bleed", () => {
    const result = sanitizeDraftText(
      "Sure, Tuesday at 2pm works for me.\n\nOn Mon, Jan 5, 2026 at 3:00 PM Jane Doe wrote:\n> Can we meet Tuesday?"
    )
    expect(result.text).toBe("Sure, Tuesday at 2pm works for me.")
    expect(result.autoFixed).toContain("quoted_thread")
    expect(result.flagged).toEqual([])
  })

  it("strips a leading AI-preamble opener", () => {
    const result = sanitizeDraftText("Here's a draft reply:\n\nThanks for reaching out, happy to help.")
    expect(result.text).toBe("Thanks for reaching out, happy to help.")
    expect(result.autoFixed).toContain("ai_preamble")
  })

  it("flags unresolved template placeholders without stripping them", () => {
    const result = sanitizeDraftText("Hi [Client Name], thanks for your note.")
    expect(result.text).toBe("Hi [Client Name], thanks for your note.")
    expect(result.flagged).toContain("unresolved_placeholder")
  })

  it("flags raw HTML/markdown artifacts", () => {
    const result = sanitizeDraftText("Sure thing <div>here you go</div> **bold**")
    expect(result.flagged).toContain("markup_artifact")
  })

  it("flags empty text after stripping", () => {
    const result = sanitizeDraftText("On Mon, Jan 5, 2026 at 3:00 PM Jane Doe wrote:\n> Can we meet Tuesday?")
    expect(result.flagged).toContain("empty_after_strip")
  })

  it("aborts stripping and flags instead when it would remove more than 40% of the text", () => {
    const original = "Short reply.\n\nOn Mon wrote:\n" + "> quoted line\n".repeat(20)
    const result = sanitizeDraftText(original)
    expect(result.text).toBe(original)
    expect(result.flagged).toContain("strip_too_aggressive")
    expect(result.autoFixed).toEqual([])
  })

  it("leaves a clean draft untouched", () => {
    const result = sanitizeDraftText("Thanks for the update, I'll take a look today.")
    expect(result.text).toBe("Thanks for the update, I'll take a look today.")
    expect(result.autoFixed).toEqual([])
    expect(result.flagged).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/draft-sanitizer.test.ts`
Expected: FAIL — `Cannot find module '@/lib/agent/draft-sanitizer'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/agent/draft-sanitizer.ts

const QUOTED_THREAD_PATTERNS = [
  /^On .+ wrote:$/im,
  /^From:\s.+$/im,
  /^-{2,}\s*Original Message\s*-{2,}/im,
]

const AI_PREAMBLE_PATTERNS = [
  /^here'?s\s+a\s+draft\s+reply:?\s*/i,
  /^sure,?\s+here'?s\s+a\s+response:?\s*/i,
  /^draft:?\s*/i,
]

const PLACEHOLDER_PATTERN = /\[[a-z0-9 _'-]{2,40}\]|\{\{[^}]{1,40}\}\}/i
const MARKUP_PATTERN = /<[a-z][a-z0-9]*[^>]*>|\*\*[^*]+\*\*|`[^`]+`/i

const MIN_VIABLE_LENGTH = 12
const MAX_STRIP_FRACTION = 0.4

export type SanitizeDraftResult = {
  text: string
  autoFixed: string[]
  flagged: string[]
}

export function sanitizeDraftText(original: string): SanitizeDraftResult {
  const trimmedOriginal = original.trim()
  let working = trimmedOriginal
  const autoFixed: string[] = []

  const beforeQuoteStrip = working
  for (const pattern of QUOTED_THREAD_PATTERNS) {
    const match = working.match(pattern)
    if (match?.index !== undefined && match.index >= 0) {
      working = working.slice(0, match.index).trim()
    }
  }
  working = working
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (working !== beforeQuoteStrip) autoFixed.push("quoted_thread")

  const beforePreambleStrip = working
  for (const pattern of AI_PREAMBLE_PATTERNS) {
    if (pattern.test(working)) {
      working = working.replace(pattern, "").trim()
      break
    }
  }
  if (working !== beforePreambleStrip) autoFixed.push("ai_preamble")

  const strippedFraction =
    trimmedOriginal.length === 0 ? 0 : 1 - working.length / trimmedOriginal.length

  if (strippedFraction > MAX_STRIP_FRACTION) {
    return { text: trimmedOriginal, autoFixed: [], flagged: ["strip_too_aggressive"] }
  }

  const flagged: string[] = []
  if (working.length < MIN_VIABLE_LENGTH) {
    flagged.push("empty_after_strip")
  }
  if (PLACEHOLDER_PATTERN.test(working)) {
    flagged.push("unresolved_placeholder")
  }
  if (MARKUP_PATTERN.test(working)) {
    flagged.push("markup_artifact")
  }

  return { text: working, autoFixed, flagged }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/draft-sanitizer.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/agent/draft-sanitizer.ts tests/draft-sanitizer.test.ts
git commit -m "feat: add draft text sanitizer for quoted-thread bleed and AI artifacts"
```

---

### Task 2: Export the classifier's bulk-mail pattern for reuse

**Files:**
- Modify: `lib/agent/email-classifier.ts:150` (the `BULK_LIST_PATTERN` declaration)
- Test: `tests/email-classifier.test.ts` (extend existing file)

**Interfaces:**
- Produces: `export const BULK_LIST_PATTERN: RegExp` — consumed by Task 3's `hasBulkMailSignals`.

- [ ] **Step 1: Write the failing test**

Add to the end of `tests/email-classifier.test.ts`:

```typescript
import { BULK_LIST_PATTERN } from "@/lib/agent/email-classifier"

describe("BULK_LIST_PATTERN", () => {
  it("is exported and matches common unsubscribe footer language", () => {
    expect(BULK_LIST_PATTERN.test("Click here to unsubscribe from this list")).toBe(true)
    expect(BULK_LIST_PATTERN.test("Thanks for the quick reply, see you Tuesday")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/email-classifier.test.ts -t "BULK_LIST_PATTERN"`
Expected: FAIL — `BULK_LIST_PATTERN` is not exported (TypeScript import error or undefined).

- [ ] **Step 3: Export the pattern**

In `lib/agent/email-classifier.ts`, change:

```typescript
const BULK_LIST_PATTERN =
```

to:

```typescript
export const BULK_LIST_PATTERN =
```

(Same line, same regex — no behavior change to `classifyEmailType`, which keeps using the module-local binding.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/email-classifier.test.ts`
Expected: PASS (all existing tests plus the new one)

- [ ] **Step 5: Commit**

```bash
git add lib/agent/email-classifier.ts tests/email-classifier.test.ts
git commit -m "refactor: export BULK_LIST_PATTERN for reuse in the draft eligibility gate"
```

---

### Task 3: Deterministic bulk-mail signal check

**Files:**
- Create: `lib/agent/draft-eligibility.ts` (this task adds only the deterministic piece; Tasks 4–5 extend the same file)
- Test: `tests/draft-eligibility.test.ts`

**Interfaces:**
- Consumes: `BULK_LIST_PATTERN` from `@/lib/agent/email-classifier` (Task 2); `extractListUnsubscribeHeader` from `@/lib/agent/unsubscribe` (existing, signature `(rawText: string) => string | null`).
- Produces: `hasBulkMailSignals(input: { body: string; rawHeaders?: string }): boolean` — consumed by Task 4's `resolveDraftEligibility`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/draft-eligibility.test.ts
import { describe, expect, it } from "vitest"
import { hasBulkMailSignals } from "@/lib/agent/draft-eligibility"

describe("hasBulkMailSignals", () => {
  it("detects an unsubscribe footer in the body", () => {
    expect(
      hasBulkMailSignals({
        body: "This week's roundup...\n\nTo stop receiving these emails, unsubscribe here.",
      })
    ).toBe(true)
  })

  it("detects a List-Unsubscribe header", () => {
    expect(
      hasBulkMailSignals({
        body: "Join our project by clicking the link below.",
        rawHeaders: "List-Unsubscribe: <mailto:unsub@example.com>",
      })
    ).toBe(true)
  })

  it("returns false for an ordinary human message", () => {
    expect(
      hasBulkMailSignals({
        body: "Hey, can you send over the contract by Friday?",
      })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/draft-eligibility.test.ts`
Expected: FAIL — `Cannot find module '@/lib/agent/draft-eligibility'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/agent/draft-eligibility.ts
import { BULK_LIST_PATTERN } from "@/lib/agent/email-classifier"
import { extractListUnsubscribeHeader } from "@/lib/agent/unsubscribe"

export function hasBulkMailSignals(input: { body: string; rawHeaders?: string }): boolean {
  if (BULK_LIST_PATTERN.test(input.body)) return true
  if (input.rawHeaders && extractListUnsubscribeHeader(input.rawHeaders)) return true
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/draft-eligibility.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/agent/draft-eligibility.ts tests/draft-eligibility.test.ts
git commit -m "feat: add deterministic bulk-mail signal check for the draft eligibility gate"
```

---

### Task 4: AI eligibility check prompt

**Files:**
- Create: `lib/ai/prompts/draft-eligibility.ts`
- Test: `tests/draft-eligibility-prompt.test.ts`

**Interfaces:**
- Produces: `buildDraftEligibilityPrompt(input: DraftEligibilityPromptInput): string`, `draftEligibilityJsonSchema: Record<string, unknown>`, `normalizeDraftEligibilityOutput(rawText: string): DraftEligibilityResult`, and the types `DraftEligibilityPromptInput`, `DraftEligibilityResult` — consumed by Task 5's `resolveDraftEligibility`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/draft-eligibility-prompt.test.ts
import { describe, expect, it } from "vitest"
import {
  buildDraftEligibilityPrompt,
  normalizeDraftEligibilityOutput,
} from "@/lib/ai/prompts/draft-eligibility"

describe("buildDraftEligibilityPrompt", () => {
  it("includes the subject and body in the prompt", () => {
    const prompt = buildDraftEligibilityPrompt({
      subject: "Join our beta",
      body: "We're launching a new feature, click here to join the waitlist.",
    })
    expect(prompt).toContain("Join our beta")
    expect(prompt).toContain("click here to join the waitlist")
  })
})

describe("normalizeDraftEligibilityOutput", () => {
  it("parses a valid needsReply=false response", () => {
    const result = normalizeDraftEligibilityOutput(
      JSON.stringify({
        needsReply: false,
        suggestedEmailType: "newsletter",
        suggestedAttentionCategory: "read_later",
        reason: "One-way product announcement, no question directed at the recipient.",
      })
    )
    expect(result.needsReply).toBe(false)
    expect(result.suggestedEmailType).toBe("newsletter")
    expect(result.suggestedAttentionCategory).toBe("read_later")
  })

  it("parses a valid needsReply=true response", () => {
    const result = normalizeDraftEligibilityOutput(
      JSON.stringify({
        needsReply: true,
        suggestedEmailType: "needs_reply",
        suggestedAttentionCategory: "needs_reply",
        reason: "Sender is asking a direct question awaiting the recipient's answer.",
      })
    )
    expect(result.needsReply).toBe(true)
  })

  it("throws on invalid JSON", () => {
    expect(() => normalizeDraftEligibilityOutput("not json")).toThrow()
  })

  it("throws on an invalid suggestedEmailType", () => {
    expect(() =>
      normalizeDraftEligibilityOutput(
        JSON.stringify({
          needsReply: false,
          suggestedEmailType: "not_a_real_type",
          suggestedAttentionCategory: "read_later",
          reason: "x",
        })
      )
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/draft-eligibility-prompt.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/prompts/draft-eligibility'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/ai/prompts/draft-eligibility.ts
import { stripHtmlToText } from "@/lib/email-body"

const EMAIL_TYPES = ["needs_reply", "notification", "newsletter", "marketing", "calendar", "fyi"] as const
const ATTENTION_CATEGORIES = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
] as const

export type DraftEligibilityPromptInput = {
  subject: string
  body: string
}

export type DraftEligibilityResult = {
  needsReply: boolean
  suggestedEmailType: (typeof EMAIL_TYPES)[number]
  suggestedAttentionCategory: (typeof ATTENTION_CATEGORIES)[number]
  reason: string
}

export const draftEligibilityJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["needsReply", "suggestedEmailType", "suggestedAttentionCategory", "reason"],
  properties: {
    needsReply: { type: "boolean" },
    suggestedEmailType: { type: "string", enum: EMAIL_TYPES as unknown as string[] },
    suggestedAttentionCategory: { type: "string", enum: ATTENTION_CATEGORIES as unknown as string[] },
    reason: { type: "string" },
  },
}

export function buildDraftEligibilityPrompt(input: DraftEligibilityPromptInput): string {
  return [
    "You are deciding whether an email genuinely expects a personal reply from the recipient,",
    "or whether it is one-way mail (a newsletter, product announcement, promotional share,",
    "notification, or content the recipient would only read, not respond to).",
    "",
    "A rule-based classifier already flagged this email as possibly needing a reply, but with",
    "low confidence — your job is to catch cases where that's wrong, such as a newsletter that",
    "happens to phrase something as a rhetorical question, or a one-way link/invite share.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    `Subject: ${truncate(input.subject, 200)}`,
    "",
    "Body:",
    truncate(stripHtmlToText(input.body, 2000), 2000),
  ].join("\n")
}

export function normalizeDraftEligibilityOutput(rawText: string): DraftEligibilityResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("Draft eligibility response was not valid JSON")
  }
  if (!isRecord(parsed)) {
    throw new Error("Draft eligibility response was not an object")
  }
  if (typeof parsed.needsReply !== "boolean") {
    throw new Error("Draft eligibility response missing needsReply")
  }
  if (!EMAIL_TYPES.includes(parsed.suggestedEmailType as (typeof EMAIL_TYPES)[number])) {
    throw new Error("Draft eligibility response has an invalid suggestedEmailType")
  }
  if (
    !ATTENTION_CATEGORIES.includes(
      parsed.suggestedAttentionCategory as (typeof ATTENTION_CATEGORIES)[number]
    )
  ) {
    throw new Error("Draft eligibility response has an invalid suggestedAttentionCategory")
  }
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : ""

  return {
    needsReply: parsed.needsReply,
    suggestedEmailType: parsed.suggestedEmailType as (typeof EMAIL_TYPES)[number],
    suggestedAttentionCategory: parsed.suggestedAttentionCategory as (typeof ATTENTION_CATEGORIES)[number],
    reason: reason || "No reason provided.",
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/draft-eligibility-prompt.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/prompts/draft-eligibility.ts tests/draft-eligibility-prompt.test.ts
git commit -m "feat: add AI draft-eligibility prompt and schema"
```

---

### Task 5: Eligibility gate orchestration and retag

**Files:**
- Modify: `lib/agent/draft-eligibility.ts` (extend from Task 3)
- Test: `tests/draft-eligibility.test.ts` (extend from Task 3)

**Interfaces:**
- Consumes: `hasBulkMailSignals` (Task 3, same file); `buildDraftEligibilityPrompt`/`draftEligibilityJsonSchema`/`normalizeDraftEligibilityOutput` (Task 4); `runAiJsonFeature` from `@/lib/ai/gateway` (existing, signature `<T>(input: RunAiJsonFeatureInput) => Promise<RunAiJsonFeatureResult<T>>`, `RunAiJsonFeatureInput` requires `tenantId, userId, userEmail, feature, messages, schemaName, schema`); `projectFlowDeskLabelsForConversation` from `@/lib/gmail-labels` (existing, signature `(input: { tenantId: string; conversationId: string }) => Promise<...>`); `prisma` from `@/lib/prisma`.
- Produces: `resolveDraftEligibility(input: ResolveDraftEligibilityInput): Promise<{ eligible: boolean; reason: string }>` — consumed by Task 6's `proposeDraftForConversation`. When `eligible` is `false`, this function has already performed the retag (updated `ConversationState`, re-projected labels, written the audit log) as a side effect — callers only need to skip draft generation.

- [ ] **Step 1: Write the failing tests**

Add to `tests/draft-eligibility.test.ts` (keep the Task 3 `describe` block, add these):

```typescript
import { beforeEach, vi } from "vitest"

const {
  mockFindUnique,
  mockUpdate,
  mockAuditCreate,
  mockRunAiJsonFeature,
  mockProjectLabels,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockRunAiJsonFeature: vi.fn(),
  mockProjectLabels: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationState: { findUnique: mockFindUnique, update: mockUpdate },
    auditLog: { create: mockAuditCreate },
  },
}))
vi.mock("@/lib/ai/gateway", () => ({ runAiJsonFeature: mockRunAiJsonFeature }))
vi.mock("@/lib/gmail-labels", () => ({ projectFlowDeskLabelsForConversation: mockProjectLabels }))

// Import after mocks are registered, matching the existing convention.
const { resolveDraftEligibility } = await import("@/lib/agent/draft-eligibility")

describe("resolveDraftEligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue({ metadataJson: {} })
    mockUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockProjectLabels.mockResolvedValue(undefined)
  })

  const baseInput = {
    tenantId: "t1",
    userId: "u1",
    userEmail: "user@example.com",
    conversationId: "conv-1",
    classification: {
      emailType: "needs_reply" as const,
      attentionCategory: "needs_reply" as const,
      confidence: 0.7,
      reason: "Human message likely expects a reply.",
    },
    message: { subject: "Join our beta", body: "We're launching, click here to join the waitlist." },
  }

  it("skips the gate entirely when confidence is above the fallback threshold", async () => {
    const result = await resolveDraftEligibility({
      ...baseInput,
      classification: { ...baseInput.classification, confidence: 0.85 },
    })
    expect(result.eligible).toBe(true)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
  })

  it("skips the gate entirely when emailType is not needs_reply", async () => {
    const result = await resolveDraftEligibility({
      ...baseInput,
      classification: { ...baseInput.classification, emailType: "notification" as const },
    })
    expect(result.eligible).toBe(true)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
  })

  it("rejects deterministically on bulk-mail signals without calling the AI gate", async () => {
    const result = await resolveDraftEligibility({
      ...baseInput,
      message: {
        subject: "Weekly roundup",
        body: "This week's roundup...\n\nTo stop receiving these emails, unsubscribe here.",
      },
    })
    expect(result.eligible).toBe(false)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: "conv-1" },
        data: expect.objectContaining({
          metadataJson: expect.objectContaining({
            emailType: "newsletter",
            attentionCategory: "read_later",
            attentionSource: "draft_gate",
          }),
        }),
      })
    )
    expect(mockProjectLabels).toHaveBeenCalledWith({ tenantId: "t1", conversationId: "conv-1" })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "draft_gate.reclassified" }),
      })
    )
  })

  it("calls the AI gate when deterministic signals are absent, and retags on rejection", async () => {
    mockRunAiJsonFeature.mockResolvedValue({
      output: {
        needsReply: false,
        suggestedEmailType: "fyi",
        suggestedAttentionCategory: "quiet",
        reason: "One-way share, no question directed at the recipient.",
      },
      model: "test-model",
      providerGenerationId: null,
    })

    const result = await resolveDraftEligibility(baseInput)

    expect(result.eligible).toBe(false)
    expect(mockRunAiJsonFeature).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", feature: "draft_gate.eligibility" })
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadataJson: expect.objectContaining({ emailType: "fyi", attentionCategory: "quiet" }),
        }),
      })
    )
  })

  it("respects the AI gate when it agrees a reply is needed", async () => {
    mockRunAiJsonFeature.mockResolvedValue({
      output: {
        needsReply: true,
        suggestedEmailType: "needs_reply",
        suggestedAttentionCategory: "needs_reply",
        reason: "Direct question awaiting an answer.",
      },
      model: "test-model",
      providerGenerationId: null,
    })

    const result = await resolveDraftEligibility(baseInput)

    expect(result.eligible).toBe(true)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/draft-eligibility.test.ts`
Expected: FAIL — `resolveDraftEligibility` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/agent/draft-eligibility.ts` (keep the Task 3 `hasBulkMailSignals` export and its imports):

```typescript
import { prisma } from "@/lib/prisma"
import { runAiJsonFeature } from "@/lib/ai/gateway"
import { projectFlowDeskLabelsForConversation } from "@/lib/gmail-labels"
import {
  buildDraftEligibilityPrompt,
  draftEligibilityJsonSchema,
  normalizeDraftEligibilityOutput,
} from "@/lib/ai/prompts/draft-eligibility"
import type { AttentionCategory, EmailType } from "@/lib/agent/email-classifier"
import { estimateTokenCount } from "@/lib/ai/usage"

const FALLBACK_CONFIDENCE = 0.7

export type ResolveDraftEligibilityInput = {
  tenantId: string
  userId: string
  userEmail: string
  conversationId: string
  classification: {
    emailType: EmailType
    attentionCategory: AttentionCategory
    confidence: number
    reason: string
  }
  message: { subject: string; body: string; rawHeaders?: string }
}

export async function resolveDraftEligibility(
  input: ResolveDraftEligibilityInput
): Promise<{ eligible: boolean; reason: string }> {
  const { classification } = input

  if (classification.emailType !== "needs_reply" || classification.confidence > FALLBACK_CONFIDENCE) {
    return { eligible: true, reason: "Classification did not hit the ambiguous fallback bucket." }
  }

  if (hasBulkMailSignals(input.message)) {
    await retagConversation(input, {
      emailType: "newsletter",
      attentionCategory: "read_later",
      reason: "Bulk-mail signals (unsubscribe footer or header) present despite falling through the specific newsletter/marketing rules.",
    })
    return { eligible: false, reason: "Deterministic bulk-mail signals detected." }
  }

  const prompt = buildDraftEligibilityPrompt({
    subject: input.message.subject,
    body: input.message.body,
  })

  const { output } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId: input.tenantId,
    userId: input.userId,
    userEmail: input.userEmail,
    feature: "draft_gate.eligibility",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_draft_eligibility",
    schema: draftEligibilityJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 150,
  })

  const result = normalizeDraftEligibilityOutput(JSON.stringify(output))

  if (!result.needsReply) {
    await retagConversation(input, {
      emailType: result.suggestedEmailType,
      attentionCategory: result.suggestedAttentionCategory,
      reason: result.reason,
    })
    return { eligible: false, reason: result.reason }
  }

  return { eligible: true, reason: result.reason }
}

async function retagConversation(
  input: ResolveDraftEligibilityInput,
  correction: { emailType: EmailType; attentionCategory: AttentionCategory; reason: string }
): Promise<void> {
  const currentState = await prisma.conversationState.findUnique({
    where: { conversationId: input.conversationId },
    select: { metadataJson: true },
  })
  const currentMeta =
    currentState?.metadataJson &&
    typeof currentState.metadataJson === "object" &&
    !Array.isArray(currentState.metadataJson)
      ? (currentState.metadataJson as Record<string, unknown>)
      : {}

  const updatedMeta = {
    ...currentMeta,
    emailType: correction.emailType,
    attentionCategory: correction.attentionCategory,
    attentionReason: correction.reason,
    attentionConfidence: 1,
    attentionSource: "draft_gate",
  }

  await prisma.conversationState.update({
    where: { conversationId: input.conversationId },
    data: { metadataJson: updatedMeta },
  })

  await projectFlowDeskLabelsForConversation({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  })

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "draft_gate.reclassified",
      payloadJson: {
        conversationId: input.conversationId,
        fromEmailType: "needs_reply",
        toEmailType: correction.emailType,
        toAttentionCategory: correction.attentionCategory,
        reason: correction.reason,
      },
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/draft-eligibility.test.ts`
Expected: PASS (all `hasBulkMailSignals` tests from Task 3 plus 5 new `resolveDraftEligibility` tests)

- [ ] **Step 5: Commit**

```bash
git add lib/agent/draft-eligibility.ts tests/draft-eligibility.test.ts
git commit -m "feat: orchestrate the draft eligibility gate with AI fallback and retag"
```

---

### Task 6: Extract shared draft-generation function

**Files:**
- Create: `lib/agent/draft-generation.ts`
- Modify: `app/api/conversations/[id]/draft/suggest/route.ts`
- Test: `tests/draft-generation.test.ts`
- Test: `tests/ai-draft-routes.test.ts` (existing — verify it still passes unmodified; it exercises the route's HTTP contract, which does not change)

**Interfaces:**
- Consumes: `resolveDraftEligibility` (Task 5); `sanitizeDraftText` (Task 1); everything currently imported by `draft/suggest/route.ts` (`getReplyGenerationContext`, `generateDraftReply`, `runAiJsonFeature`, `buildDraftReplyPrompt`, `buildPersonalDraftReplyPrompt`, `draftReplyJsonSchema`, `normalizeDraftReplyOutput`, `summarizeConversation`, `estimateTokenCount`, `recordAiUsageEvent`, `prisma`, `revalidateInboxViews`, `conversationUpdateForDraftReady`, `latestMeaningfulInboundMessage`, `queueGmailDraftWriteback`, `projectFlowDeskLabelsForConversation`, `ensureDraftApprovalRequest`, `validateDraftWritingPreferences`, `detectSensitiveMatches`, `classifyEmailType`).
- Produces: `proposeDraftForConversation(input: ProposeDraftInput): Promise<ProposeDraftResult>` — consumed by Task 7 (automatic trigger) and Task 9 (backfill endpoint). `ProposeDraftResult` is a discriminated union so callers can distinguish "drafted" from "gated out" from "error" without parsing strings.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/draft-generation.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockFindFirstConversation,
  mockUpsertDraft,
  mockUpdateConversation,
  mockAuditCreate,
  mockEnsureApproval,
  mockQueueWriteback,
  mockProjectLabels,
  mockResolveEligibility,
  mockGetReplyContext,
  mockGenerateDraftReply,
} = vi.hoisted(() => ({
  mockFindFirstConversation: vi.fn(),
  mockUpsertDraft: vi.fn(),
  mockUpdateConversation: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockEnsureApproval: vi.fn(),
  mockQueueWriteback: vi.fn(),
  mockProjectLabels: vi.fn(),
  mockResolveEligibility: vi.fn(),
  mockGetReplyContext: vi.fn(),
  mockGenerateDraftReply: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockFindFirstConversation, update: mockUpdateConversation },
    draft: { upsert: mockUpsertDraft },
    auditLog: { create: mockAuditCreate },
    agentJob: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock("@/lib/agent/approvals", () => ({ ensureDraftApprovalRequest: mockEnsureApproval }))
vi.mock("@/lib/gmail-drafts", () => ({
  queueGmailDraftWriteback: mockQueueWriteback,
  latestMeaningfulInboundMessage: vi.fn().mockReturnValue(null),
}))
vi.mock("@/lib/gmail-labels", () => ({ projectFlowDeskLabelsForConversation: mockProjectLabels }))
vi.mock("@/lib/agent/draft-eligibility", () => ({ resolveDraftEligibility: mockResolveEligibility }))
vi.mock("@/lib/agent/reply-context", () => ({ getReplyGenerationContext: mockGetReplyContext }))
vi.mock("@/lib/ai/provider", () => ({ generateDraftReply: mockGenerateDraftReply }))
vi.mock("@/lib/cache-tags", () => ({ revalidateInboxViews: vi.fn() }))

const { proposeDraftForConversation } = await import("@/lib/agent/draft-generation")

describe("proposeDraftForConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstConversation.mockResolvedValue({
      id: "conv-1",
      tenantId: "t1",
      channelId: "ch1",
      contactId: null,
      channel: { type: "email", provider: "google" },
      externalThreadId: "thread-1",
      messages: [
        { direction: "inbound", body: "Can we meet Tuesday?", createdAt: new Date(), providerMessageId: "m1" },
      ],
      draft: null,
    })
    mockGetReplyContext.mockResolvedValue({
      accountType: "personal",
      businessProfile: null,
      knowledgeDocuments: [],
      learnedProfile: null,
      writingPreferences: null,
    })
    mockGenerateDraftReply.mockResolvedValue({
      draftText: "Tuesday works for me.",
      intent: "reply",
      confidence: 0.8,
      riskLevel: "low",
      suggestedLabel: null,
      escalationReason: null,
      citedDocumentIds: [],
      model: "test-model",
    })
    mockResolveEligibility.mockResolvedValue({ eligible: true, reason: "ok" })
    mockUpsertDraft.mockResolvedValue({ id: "draft-1", text: "Tuesday works for me.", status: "proposed" })
    mockUpdateConversation.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockEnsureApproval.mockResolvedValue({})
    mockQueueWriteback.mockResolvedValue({})
    mockProjectLabels.mockResolvedValue(undefined)
  })

  it("skips the eligibility gate for source: manual", async () => {
    const result = await proposeDraftForConversation({
      tenantId: "t1",
      conversationId: "conv-1",
      source: "manual",
    })
    expect(mockResolveEligibility).not.toHaveBeenCalled()
    expect(result.status).toBe("drafted")
  })

  it("runs the eligibility gate for source: automatic and skips drafting when ineligible", async () => {
    mockResolveEligibility.mockResolvedValue({ eligible: false, reason: "newsletter" })

    const result = await proposeDraftForConversation({
      tenantId: "t1",
      conversationId: "conv-1",
      source: "automatic",
    })

    expect(mockResolveEligibility).toHaveBeenCalled()
    expect(mockUpsertDraft).not.toHaveBeenCalled()
    expect(result).toEqual({ status: "gated_out", reason: "newsletter" })
  })

  it("drafts when the gate approves for source: automatic", async () => {
    const result = await proposeDraftForConversation({
      tenantId: "t1",
      conversationId: "conv-1",
      source: "automatic",
    })

    expect(result.status).toBe("drafted")
    expect(mockUpsertDraft).toHaveBeenCalled()
    expect(mockQueueWriteback).toHaveBeenCalled()
  })

  it("sanitizes the draft text before saving, recording auto-fixes in metadata", async () => {
    mockGenerateDraftReply.mockResolvedValue({
      draftText: "Sounds good.\n\nOn Mon wrote:\n> original message",
      intent: "reply",
      confidence: 0.8,
      riskLevel: "low",
      suggestedLabel: null,
      escalationReason: null,
      citedDocumentIds: [],
      model: "test-model",
    })

    await proposeDraftForConversation({ tenantId: "t1", conversationId: "conv-1", source: "manual" })

    expect(mockUpsertDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          text: "Sounds good.",
          metadataJson: expect.objectContaining({ sanitizerAutoFixed: ["quoted_thread"] }),
        }),
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/draft-generation.test.ts`
Expected: FAIL — `Cannot find module '@/lib/agent/draft-generation'`

- [ ] **Step 3: Write the implementation**

`lib/agent/draft-generation.ts` is the full logic of the current route handler (both the personal- and business-account branches, plus the draft-cache short-circuit and the writing-preference regeneration retry), generalized to accept a `conversationId`/`tenantId` pair instead of reading from an HTTP request. This mirrors `app/api/conversations/[id]/draft/suggest/route.ts` lines 64–406 (already read in full during design) with these changes: (a) conversation/session lookup is parameterized instead of reading `getServerSession`, (b) `userInstruction` becomes an optional input field instead of being parsed from the request body, (c) the eligibility gate runs before generation when `source !== "manual"`, (d) the cache short-circuit only applies for `source === "manual"`, (e) `sanitizeDraftText` runs on `result.draftText` after the writing-preferences check/retry, (f) the return type is a discriminated union instead of `NextResponse`.

```typescript
// lib/agent/draft-generation.ts
import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"
import { classifyEmailType } from "@/lib/agent/email-classifier"
import { detectSensitiveMatches } from "@/lib/agent/risk-radar"
import { getReplyGenerationContext } from "@/lib/agent/reply-context"
import { generateDraftReply } from "@/lib/ai/provider"
import { runAiJsonFeature } from "@/lib/ai/gateway"
import {
  buildDraftReplyPrompt,
  buildPersonalDraftReplyPrompt,
  draftReplyJsonSchema,
  normalizeDraftReplyOutput,
} from "@/lib/ai/prompts/draft-reply"
import { summarizeConversation } from "@/lib/ai/summarize"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"
import { revalidateInboxViews } from "@/lib/cache-tags"
import { conversationUpdateForDraftReady } from "@/lib/workflow-status-transitions"
import { latestMeaningfulInboundMessage, queueGmailDraftWriteback } from "@/lib/gmail-drafts"
import { projectFlowDeskLabelsForConversation } from "@/lib/gmail-labels"
import { ensureDraftApprovalRequest } from "@/lib/agent/approvals"
import { validateDraftWritingPreferences } from "@/lib/agent/writing-preferences"
import { resolveDraftEligibility } from "@/lib/agent/draft-eligibility"
import { sanitizeDraftText } from "@/lib/agent/draft-sanitizer"

const VALID_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const

export type ProposeDraftInput = {
  tenantId: string
  conversationId: string
  userId?: string
  userEmail?: string
  userInstruction?: string | null
  source: "manual" | "automatic" | "backfill"
}

export type ProposeDraftResult =
  | { status: "drafted"; draftId: string }
  | { status: "gated_out"; reason: string }
  | { status: "not_applicable"; reason: string }
  | { status: "error"; message: string }

export async function proposeDraftForConversation(
  input: ProposeDraftInput
): Promise<ProposeDraftResult> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    include: {
      channel: true,
      messages: { orderBy: { createdAt: "asc" }, take: 40 },
      draft: true,
    },
  })

  if (!conversation) return { status: "not_applicable", reason: "Conversation not found" }
  if (conversation.channel.type !== "email") {
    return { status: "not_applicable", reason: "AI drafts are only available for email conversations" }
  }

  if (input.source !== "manual") {
    const firstInbound = conversation.messages.find((m) => m.direction === "inbound")
    if (firstInbound) {
      const classification = classifyEmailType({
        fromEmail: firstInbound.fromE164 ?? "",
        subject: "",
        body: firstInbound.body,
      })
      const eligibility = await resolveDraftEligibility({
        tenantId: input.tenantId,
        userId: input.userId ?? "",
        userEmail: input.userEmail ?? "",
        conversationId: conversation.id,
        classification,
        message: { subject: "", body: firstInbound.body },
      })
      if (!eligibility.eligible) {
        return { status: "gated_out", reason: eligibility.reason }
      }
    }
  }

  const context = await getReplyGenerationContext({
    tenantId: input.tenantId,
    channelId: conversation.channelId,
    conversationId: conversation.id,
    contactId: conversation.contactId,
  })
  const accountType = context.accountType
  const conversationSummary = summarizeConversation(conversation.messages)

  let result: Awaited<ReturnType<typeof generateDraftReply>>
  let promptVersion: string
  let knowledgeDocumentIds: string[] = []
  let draftCacheKey: string

  try {
    if (accountType === "personal") {
      promptVersion = "personal-draft-v1"
      const prompt = buildPersonalDraftReplyPrompt({
        personalProfile: learnedProfileToPersonalStyle(context.learnedProfile),
        messages: conversation.messages,
        conversationSummary,
        userInstruction: input.userInstruction ?? null,
        writingPreferences: context.writingPreferences,
      })
      draftCacheKey = buildDraftCacheKey(promptVersion, accountType, prompt)

      // Only the manual, user-triggered path benefits from returning a
      // cached draft as-is — automatic/backfill callers only run when a
      // fresh inbound message just arrived, so a cache hit there would mean
      // "nothing changed," which their caller already guards against via
      // conversation.draft being null.
      if (input.source === "manual") {
        const cached = await cachedDraftResult({
          tenantId: input.tenantId,
          conversationId: conversation.id,
          draft: conversation.draft,
          draftCacheKey,
        })
        if (cached) return cached
      }

      const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
        tenantId: input.tenantId,
        userId: input.userId ?? "",
        userEmail: input.userEmail ?? "",
        feature: "autopilot.draft",
        messages: [{ role: "user", content: prompt }],
        schemaName: "flowdesk_draft_reply",
        schema: draftReplyJsonSchema,
        estimatedInputTokens: estimateTokenCount(prompt),
        estimatedOutputTokens: 500,
      })
      result = normalizeDraftReplyOutput(JSON.stringify(output), model)
    } else {
      if (!context.businessProfile) {
        return { status: "not_applicable", reason: "Business profile is required before generating drafts" }
      }
      promptVersion = context.learnedProfile ? "business-draft-learned-v1" : "ai-draft-mvp-v1"
      knowledgeDocumentIds = context.knowledgeDocuments.map((doc) => doc.id)

      const latestJob = await prisma.agentJob.findFirst({
        where: { conversationId: conversation.id, tenantId: input.tenantId, status: "completed" },
        orderBy: { completedAt: "desc" },
      })
      const availableSlots = Array.isArray(latestJob?.slotsJson)
        ? (latestJob.slotsJson as string[])
        : undefined

      const draftInput = {
        aiContext: { tenantId: input.tenantId, userId: input.userId ?? "", userEmail: input.userEmail ?? "" },
        businessProfile: context.businessProfile,
        knowledgeDocuments: context.knowledgeDocuments,
        learnedReplyProfile: context.learnedProfile,
        messages: conversation.messages,
        conversationSummary,
        availableSlots,
        userInstruction: input.userInstruction ?? null,
        writingPreferences: context.writingPreferences,
      }
      const prompt = buildDraftReplyPrompt(draftInput)
      draftCacheKey = buildDraftCacheKey(promptVersion, accountType, prompt)

      if (input.source === "manual") {
        const cached = await cachedDraftResult({
          tenantId: input.tenantId,
          conversationId: conversation.id,
          draft: conversation.draft,
          draftCacheKey,
        })
        if (cached) return cached
      }

      result = await generateDraftReply(draftInput)
    }
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Failed to generate AI draft" }
  }

  const writingPreferenceFailures = validateDraftWritingPreferences(result.draftText, context.writingPreferences)
  if (writingPreferenceFailures.length > 0) {
    try {
      if (accountType === "personal") {
        const retryPrompt = buildPersonalDraftReplyPrompt({
          personalProfile: learnedProfileToPersonalStyle(context.learnedProfile),
          messages: conversation.messages,
          conversationSummary,
          userInstruction: input.userInstruction ?? null,
          writingPreferences: context.writingPreferences,
          writingPreferenceValidationFailures: writingPreferenceFailures,
        })
        const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
          tenantId: input.tenantId,
          userId: input.userId ?? "",
          userEmail: input.userEmail ?? "",
          feature: "autopilot.draft",
          messages: [{ role: "user", content: retryPrompt }],
          schemaName: "flowdesk_draft_reply",
          schema: draftReplyJsonSchema,
          estimatedInputTokens: estimateTokenCount(retryPrompt),
          estimatedOutputTokens: 500,
        })
        result = normalizeDraftReplyOutput(JSON.stringify(output), model)
      } else if (context.businessProfile) {
        result = await generateDraftReply({
          aiContext: { tenantId: input.tenantId, userId: input.userId ?? "", userEmail: input.userEmail ?? "" },
          businessProfile: context.businessProfile,
          knowledgeDocuments: context.knowledgeDocuments,
          learnedReplyProfile: context.learnedProfile,
          messages: conversation.messages,
          conversationSummary,
          userInstruction: input.userInstruction ?? null,
          writingPreferences: context.writingPreferences,
          writingPreferenceValidationFailures: writingPreferenceFailures,
        })
      }
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : "Failed to regenerate AI draft" }
    }

    // Only the manual path errors out to the user on a second violation — it's
    // the only caller with someone waiting on a synchronous response.
    // Automatic/backfill callers accept the second attempt as-is; anything
    // still wrong with it is the sanitizer's and the approval queue's job to
    // catch, same as today's writing-preference behavior for those paths
    // (which didn't exist before this feature, so there's no regression).
    if (input.source === "manual") {
      const remaining = validateDraftWritingPreferences(result.draftText, context.writingPreferences)
      if (remaining.length > 0) {
        return {
          status: "error",
          message: `Draft requires review because it violates writing preferences: ${remaining.join("; ")}`,
        }
      }
    }
  }

  const sanitized = sanitizeDraftText(result.draftText)

  const suggestedLabel = accountType === "business" ? result.suggestedLabel : null
  const conversationText = conversation.messages.map((m) => m.body).join("\n")
  const sensitiveMatches = detectSensitiveMatches(conversationText)
  const sourceInbound = latestMeaningfulInboundMessage(conversation.messages)
  const existingDraftMetadata =
    conversation.draft?.metadataJson &&
    typeof conversation.draft.metadataJson === "object" &&
    !Array.isArray(conversation.draft.metadataJson)
      ? (conversation.draft.metadataJson as Record<string, unknown>)
      : {}

  const metadataJson = {
    intent: result.intent,
    confidence: result.confidence,
    riskLevel: result.riskLevel,
    suggestedLabel,
    escalationReason: result.escalationReason,
    model: result.model,
    promptVersion,
    accountType,
    autoSendEligible: false,
    autoSendHoldReason: "manual_draft_suggestion",
    knowledgeDocumentIds,
    source: input.source,
    draftCacheKey,
    ...(sanitized.autoFixed.length > 0 ? { sanitizerAutoFixed: sanitized.autoFixed } : {}),
    ...(sanitized.flagged.length > 0 ? { sanitizerFlags: sanitized.flagged } : {}),
    ...(sourceInbound
      ? {
          sourceInboundMessageId: sourceInbound.providerMessageId,
          sourceInboundAt: sourceInbound.createdAt.toISOString(),
        }
      : {}),
    ...(typeof existingDraftMetadata.gmailDraftId === "string"
      ? { gmailDraftId: existingDraftMetadata.gmailDraftId }
      : {}),
  }

  const draft = await prisma.draft.upsert({
    where: { conversationId: conversation.id },
    create: { conversationId: conversation.id, text: sanitized.text, status: "proposed", metadataJson },
    update: { text: sanitized.text, status: "proposed", metadataJson },
  })

  await ensureDraftApprovalRequest({
    tenantId: input.tenantId,
    conversationId: conversation.id,
    draftId: draft.id,
    source: `draft_suggest_${input.source}`,
  })

  if (accountType === "business" && suggestedLabel && VALID_LABELS.includes(suggestedLabel)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { label: suggestedLabel, ...conversationUpdateForDraftReady() },
    })
  } else {
    await prisma.conversation.update({ where: { id: conversation.id }, data: conversationUpdateForDraftReady() })
  }

  if (conversation.channel.provider === "google" && conversation.externalThreadId) {
    try {
      await queueGmailDraftWriteback({
        tenantId: input.tenantId,
        channelId: conversation.channelId,
        conversationId: conversation.id,
        threadId: conversation.externalThreadId,
      })
      await projectFlowDeskLabelsForConversation({ tenantId: input.tenantId, conversationId: conversation.id })
    } catch (err) {
      console.error("[draft-generation] Gmail draft/label writeback failed:", err)
    }
  }

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "draft.suggest",
      payloadJson: { conversationId: conversation.id, draftId: draft.id, accountType, source: input.source, metadata: metadataJson },
    },
  })

  revalidateInboxViews(input.tenantId, conversation.id)
  return { status: "drafted", draftId: draft.id }
}

function learnedProfileToPersonalStyle(profile: {
  styleSummaryJson?: unknown
  exampleSnippetsJson?: unknown
} | null) {
  if (!profile || typeof profile.styleSummaryJson !== "object" || profile.styleSummaryJson === null) {
    return null
  }
  const style = profile.styleSummaryJson as Record<string, unknown>
  const snippets = Array.isArray(profile.exampleSnippetsJson)
    ? profile.exampleSnippetsJson.filter((item): item is string => typeof item === "string").join("\n")
    : null
  return {
    toneSummary: typeof style.tone === "string" ? style.tone : null,
    greetingPatterns: typeof style.greetings === "string" ? style.greetings : null,
    signoffPatterns: typeof style.signoffs === "string" ? style.signoffs : null,
    sentenceLengthStyle: typeof style.length === "string" ? style.length : null,
    formalityLevel: typeof style.formality === "string" ? style.formality : null,
    recurringPhrasesToUse: Array.isArray(style.commonPhrases)
      ? style.commonPhrases.filter((item): item is string => typeof item === "string")
      : [],
    recurringPhrasesToAvoid: Array.isArray(style.thingsToAvoid)
      ? style.thingsToAvoid.filter((item): item is string => typeof item === "string")
      : [],
    sanitizedExamples: snippets,
  }
}

function buildDraftCacheKey(promptVersion: string, accountType: string, prompt: string): string {
  return createHash("sha256").update(`${promptVersion}\n${accountType}\n${prompt}`).digest("hex")
}

// Reproduces the original route's maybeReturnCachedDraft side effects (audit
// log, approval-request refresh, cache-hit usage event, workflow status)
// while returning a ProposeDraftResult instead of a NextResponse.
async function cachedDraftResult(input: {
  tenantId: string
  conversationId: string
  draft: { id: string; text: string; status: string; metadataJson?: unknown } | null
  draftCacheKey: string
}): Promise<{ status: "drafted"; draftId: string } | null> {
  const metadata =
    input.draft?.metadataJson &&
    typeof input.draft.metadataJson === "object" &&
    !Array.isArray(input.draft.metadataJson)
      ? (input.draft.metadataJson as Record<string, unknown>)
      : null

  if (
    input.draft?.status !== "proposed" ||
    !input.draft.text.trim() ||
    metadata?.draftCacheKey !== input.draftCacheKey
  ) {
    return null
  }

  await ensureDraftApprovalRequest({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    draftId: input.draft.id,
    source: "draft_suggest_cache_hit",
  })
  await recordAiUsageEvent({
    tenantId: input.tenantId,
    feature: "draft.suggest.cache_hit",
    model: typeof metadata?.model === "string" ? metadata.model : "none",
    status: "skipped",
  })
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "draft.suggest.cache_hit",
      payloadJson: { conversationId: input.conversationId, draftId: input.draft.id },
    },
  })
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: conversationUpdateForDraftReady(),
  })

  return { status: "drafted", draftId: input.draft.id }
}
```

- [ ] **Step 4: Update the route to call the shared function**

Replace the body of `app/api/conversations/[id]/draft/suggest/route.ts` (the whole file) with:

```typescript
// app/api/conversations/[id]/draft/suggest/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { proposeDraftForConversation } from "@/lib/agent/draft-generation"

export const runtime = "nodejs"

const MAX_USER_INSTRUCTION_LENGTH = 500

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userInstruction = await parseUserInstruction(request)
  if (userInstruction instanceof NextResponse) return userInstruction

  const result = await proposeDraftForConversation({
    tenantId: session.user.tenantId,
    conversationId: params.id,
    userId: session.user.id,
    userEmail: session.user.email ?? "",
    userInstruction,
    source: "manual",
  })

  if (result.status === "not_applicable") {
    return NextResponse.json({ error: result.reason }, { status: result.reason === "Conversation not found" ? 404 : 400 })
  }
  if (result.status === "error") {
    const status = result.message.includes("spend limit reached") ? 429 : 502
    return NextResponse.json({ error: result.message }, { status })
  }
  if (result.status === "gated_out") {
    return NextResponse.json({ error: result.reason }, { status: 422 })
  }

  const draft = await prisma.draft.findUnique({ where: { conversationId: params.id } })
  return NextResponse.json({ draft, meta: draft?.metadataJson ?? {} })
}

async function parseUserInstruction(request: Request): Promise<string | null | NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const value = (body as Record<string, unknown>).userInstruction
  if (value === undefined || value === null) return null
  if (typeof value !== "string") {
    return NextResponse.json({ error: "User instruction must be text" }, { status: 400 })
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_USER_INSTRUCTION_LENGTH) {
    return NextResponse.json({ error: "User instruction must be 500 characters or fewer" }, { status: 400 })
  }
  return trimmed
}
```

Since `source: "manual"` never calls `resolveDraftEligibility` (guarded in Step 3), this route's behavior for the happy path is unchanged; the 422 branch for `gated_out` is unreachable from this route today and only documented for completeness/future-proofing.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/draft-generation.test.ts tests/ai-draft-routes.test.ts tests/ai-draft-provider.test.ts`
Expected: PASS. If `tests/ai-draft-routes.test.ts` fails on mock paths that assumed inline route logic, update its mocks to target `@/lib/agent/draft-generation`'s `proposeDraftForConversation` instead of the route's former direct dependencies — the HTTP-level assertions (status codes, response shape) must still hold.

- [ ] **Step 6: Commit**

```bash
git add lib/agent/draft-generation.ts app/api/conversations/[id]/draft/suggest/route.ts tests/draft-generation.test.ts tests/ai-draft-routes.test.ts
git commit -m "refactor: extract shared proposeDraftForConversation from the manual draft route"
```

---

### Task 7: Automatic draft trigger in work-item-sync

**Files:**
- Modify: `lib/agent/work-item-sync.ts` (add a block after the existing label-projection call, around line 210)
- Test: `tests/work-item-sync.test.ts` (existing — extend; if this file doesn't exist, check for the actual sync test file name with `find tests -iname "*work-item*"` and extend that instead)

**Interfaces:**
- Consumes: `proposeDraftForConversation` (Task 6); `getAutomationLevel` from `@/lib/agent/automation-level` (existing, `(tenantId: string) => Promise<number>`).

- [ ] **Step 1: Locate the existing sync test file and write the failing test**

Run: `find tests -iname "*work-item*"` to get the exact filename, then add a test in that file (adapt the existing mock setup already present in the file — it already mocks `@/lib/prisma` and most of `work-item-sync.ts`'s dependencies per the codebase's `vi.hoisted()` convention):

```typescript
// Add to the located work-item-sync test file, alongside its existing vi.mock calls:
const mockProposeDraft = vi.hoisted(() => vi.fn())
vi.mock("@/lib/agent/draft-generation", () => ({ proposeDraftForConversation: mockProposeDraft }))
const mockGetAutomationLevel = vi.hoisted(() => vi.fn())
vi.mock("@/lib/agent/automation-level", () => ({ getAutomationLevel: mockGetAutomationLevel }))

describe("automatic draft trigger", () => {
  it("proposes a draft when a conversation newly needs a reply at automation level 3+", async () => {
    mockGetAutomationLevel.mockResolvedValue(3)
    mockProposeDraft.mockResolvedValue({ status: "drafted", draftId: "d1" })
    // ...set up the existing conversation/classification mocks so
    // detectedAttentionCategory resolves to "needs_reply" and
    // conversation.draft is null (reuse this file's existing fixture setup)...

    await syncConversationWorkItems({ tenantId: "t1", conversationId: "conv-1" })

    expect(mockProposeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", conversationId: "conv-1", source: "automatic" })
    )
  })

  it("does not propose a draft below automation level 3", async () => {
    mockGetAutomationLevel.mockResolvedValue(2)

    await syncConversationWorkItems({ tenantId: "t1", conversationId: "conv-1" })

    expect(mockProposeDraft).not.toHaveBeenCalled()
  })

  it("does not propose a draft when one already exists for the conversation", async () => {
    mockGetAutomationLevel.mockResolvedValue(3)
    // ...set up the fixture so conversation.draft is non-null...

    await syncConversationWorkItems({ tenantId: "t1", conversationId: "conv-1" })

    expect(mockProposeDraft).not.toHaveBeenCalled()
  })
})
```

(The exact fixture wiring depends on the file's existing mock shape — match the pattern already used by its other `describe` blocks for setting `detectedAttentionCategory`/classification results, rather than introducing a new mocking style.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run <located-test-file> -t "automatic draft trigger"`
Expected: FAIL — `proposeDraftForConversation` never called (trigger doesn't exist yet).

- [ ] **Step 3: Add the trigger**

In `lib/agent/work-item-sync.ts`, add the import:

```typescript
import { proposeDraftForConversation } from "@/lib/agent/draft-generation"
import { getAutomationLevel } from "@/lib/agent/automation-level"
```

Then, immediately after the existing label-projection block (after the closing `}` that follows the `projectFlowDeskLabelsForConversation` call, i.e. right after line ~210 in the version read during design — the block starting `if ((!hasUserOverride || waitingOnLifecycleChanged) && !hasLabelOverride) { ... }`), add:

```typescript
  // Automatic Gmail draft creation (Level 3+): mirrors the label-projection
  // trigger above. Only fires for conversations that newly need a reply, with
  // no existing draft — proposeDraftForConversation's own idempotency (draft
  // cache key, source-inbound tracking) prevents duplicate work on re-sync.
  if (
    !hasUserOverrideOrLabelHold &&
    detectedAttentionCategory === "needs_reply" &&
    !conversation.draft
  ) {
    const automationLevel = await getAutomationLevel(conversation.tenantId)
    if (automationLevel >= 3) {
      try {
        await proposeDraftForConversation({
          tenantId: conversation.tenantId,
          conversationId: conversation.id,
          source: "automatic",
        })
      } catch (err) {
        console.error("[work-item-sync] automatic draft proposal failed:", err)
      }
    }
  }
```

This references `detectedAttentionCategory`, which is already assigned earlier in the function (visible at line 507 in the version read during design, inside the classification block) — no new variable needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run <located-test-file>`
Expected: PASS (all existing tests in the file plus the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add lib/agent/work-item-sync.ts <located-test-file>
git commit -m "feat: trigger automatic Gmail draft creation from work-item sync at Level 3+"
```

---

### Task 8: Sanitizer gate on autopilot's auto-send path

**Files:**
- Modify: `lib/agent/autopilot.ts` (inside `attemptAutopilotSend`, between the `generateDraftReply` call and the `prisma.draft.upsert` call — original lines 264–296)
- Test: `tests/autopilot.test.ts` (existing — extend; confirm exact filename with `find tests -iname "*autopilot*"`)

**Interfaces:**
- Consumes: `sanitizeDraftText` (Task 1).

- [ ] **Step 1: Write the failing test**

Add to the located autopilot test file (matching its existing mock/fixture conventions for `attemptAutopilotSend`):

```typescript
describe("attemptAutopilotSend sanitizer gate", () => {
  it("falls back to a proposed draft instead of auto-sending when the sanitizer flags an issue", async () => {
    mockGenerateDraftReply.mockResolvedValue({
      draftText: "Sure, see you then. [Client Name]",
      // ...other required DraftReplyResult fields per this file's existing fixture...
    })

    const result = await attemptAutopilotSend(jobId, classification, policy)

    expect(result).toEqual({ sent: false, reason: "Draft held for review: sanitizer flagged unresolved_placeholder" })
    expect(mockSendConversationMessage).not.toHaveBeenCalled()
    expect(mockDraftUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "proposed" }),
      })
    )
  })

  it("still auto-sends a clean draft (unchanged behavior)", async () => {
    mockGenerateDraftReply.mockResolvedValue({
      draftText: "Sure, see you then.",
      // ...other required fields...
    })

    const result = await attemptAutopilotSend(jobId, classification, policy)

    expect(result).toMatchObject({ sent: true })
    expect(mockSendConversationMessage).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run <located-autopilot-test-file> -t "sanitizer gate"`
Expected: FAIL — the placeholder text is currently sent unmodified (`sent: true`), not held.

- [ ] **Step 3: Add the sanitizer gate**

In `lib/agent/autopilot.ts`, add the import:

```typescript
import { sanitizeDraftText } from "@/lib/agent/draft-sanitizer"
```

Replace:

```typescript
  let draftText: string
  try {
    const result = await generateDraftReply(draftInput)
    draftText = result.draftText
  } catch (err) {
```

with:

```typescript
  let draftText: string
  let sanitizerFlags: string[] = []
  try {
    const result = await generateDraftReply(draftInput)
    const sanitized = sanitizeDraftText(result.draftText)
    draftText = sanitized.text
    sanitizerFlags = sanitized.flagged
  } catch (err) {
```

(leave the `catch` block itself unchanged). Then, immediately after the existing `const draft = await prisma.draft.upsert({...})` block (original lines 285–296), insert:

```typescript
  if (sanitizerFlags.length > 0) {
    await prisma.draft.update({ where: { id: draft.id }, data: { status: "proposed" } })
    await prisma.auditLog.create({
      data: {
        tenantId: job.tenantId,
        action: "autopilot.draft_held_for_sanitizer",
        payloadJson: { jobId, conversationId: job.conversationId, draftId: draft.id, flags: sanitizerFlags },
      },
    })
    return { sent: false, reason: `Draft held for review: sanitizer flagged ${sanitizerFlags.join(", ")}` }
  }
```

The subsequent `sendConversationMessage` call and everything after it (original lines 312–357) is unchanged and only runs when `sanitizerFlags.length === 0`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run <located-autopilot-test-file>`
Expected: PASS (all existing autopilot tests plus the 2 new sanitizer-gate tests)

- [ ] **Step 5: Commit**

```bash
git add lib/agent/autopilot.ts <located-autopilot-test-file>
git commit -m "fix: hold autopilot auto-send drafts for review when the sanitizer flags content issues"
```

---

### Task 9: Backfill endpoint

**Files:**
- Create: `app/api/autopilot-settings/backfill-drafts/route.ts`
- Test: `tests/backfill-drafts-route.test.ts`

**Interfaces:**
- Consumes: `proposeDraftForConversation` (Task 6, with `source: "backfill"`).
- Produces: `POST /api/autopilot-settings/backfill-drafts` — request body `{ scope: "all" | "last_n"; n?: number }`, response `{ results: Array<{ conversationId: string; status: "drafted" | "gated_out" | "not_applicable" | "error" }> }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/backfill-drafts-route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetServerSession, mockFindMany, mockProposeDraft } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockFindMany: vi.fn(),
  mockProposeDraft: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: { conversation: { findMany: mockFindMany } } }))
vi.mock("@/lib/agent/draft-generation", () => ({ proposeDraftForConversation: mockProposeDraft }))

const { POST } = await import("@/app/api/autopilot-settings/backfill-drafts/route")

describe("POST /api/autopilot-settings/backfill-drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1", id: "u1", email: "a@b.com" } })
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "all" }) }))
    expect(res.status).toBe(401)
  })

  it("proposes a draft for each needs_reply conversation without an existing draft, scope all", async () => {
    mockFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }])
    mockProposeDraft
      .mockResolvedValueOnce({ status: "drafted", draftId: "d1" })
      .mockResolvedValueOnce({ status: "gated_out", reason: "newsletter" })

    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "all" }) }))
    const data = await res.json()

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "t1", status: "needs_reply", draft: null }),
      })
    )
    expect(mockProposeDraft).toHaveBeenCalledTimes(2)
    expect(mockProposeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c1", source: "backfill" })
    )
    expect(data.results).toEqual([
      { conversationId: "c1", status: "drafted" },
      { conversationId: "c2", status: "gated_out" },
    ])
  })

  it("caps to 10 conversations for scope last_n with n=10", async () => {
    mockFindMany.mockResolvedValue([])
    await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "last_n", n: 10 }) }))
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }))
  })

  it("caps requests at 50 conversations regardless of requested n", async () => {
    mockFindMany.mockResolvedValue([])
    await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "last_n", n: 500 }) }))
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
  })

  it("rejects an invalid scope", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "bogus" }) }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/backfill-drafts-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/autopilot-settings/backfill-drafts/route'`

- [ ] **Step 3: Write the implementation**

```typescript
// app/api/autopilot-settings/backfill-drafts/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { proposeDraftForConversation } from "@/lib/agent/draft-generation"

export const runtime = "nodejs"

const HARD_CAP = 50

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const scope = (body as Record<string, unknown>).scope
  const n = (body as Record<string, unknown>).n

  if (scope !== "all" && scope !== "last_n") {
    return NextResponse.json({ error: "scope must be \"all\" or \"last_n\"" }, { status: 400 })
  }

  const take = scope === "last_n" ? Math.min(typeof n === "number" ? n : 10, HARD_CAP) : HARD_CAP

  const conversations = await prisma.conversation.findMany({
    where: { tenantId: session.user.tenantId, status: "needs_reply", draft: null },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true },
  })

  const results: Array<{ conversationId: string; status: string }> = []
  for (const conversation of conversations) {
    const result = await proposeDraftForConversation({
      tenantId: session.user.tenantId,
      conversationId: conversation.id,
      userId: session.user.id,
      userEmail: session.user.email ?? "",
      source: "backfill",
    })
    results.push({ conversationId: conversation.id, status: result.status })
  }

  return NextResponse.json({ results })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/backfill-drafts-route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/autopilot-settings/backfill-drafts/route.ts tests/backfill-drafts-route.test.ts
git commit -m "feat: add bulk draft backfill endpoint for level-3+ upgrades"
```

---

### Task 10: Backfill banner in settings UI

**Files:**
- Modify: `app/api/autopilot-settings/route.ts` (PATCH handler)
- Modify: `app/settings/AutopilotSettingsForm.tsx`
- Test: `tests/autopilot-settings-route.test.ts` (existing — confirm filename with `find tests -iname "*autopilot-settings*"`, extend it)

**Interfaces:**
- Produces (route): PATCH response gains optional fields `backfillAvailable: boolean` and `backfillEligibleCount: number`, present only when `automationLevel` was patched and crossed upward through the Level-3 threshold.

- [ ] **Step 1: Write the failing test**

Add to the located autopilot-settings route test file:

```typescript
describe("PATCH /api/autopilot-settings backfill signal", () => {
  it("includes backfillAvailable and an eligible count when crossing from below 3 to 3+", async () => {
    mockFindUnique.mockResolvedValue({ automationLevel: 2 })
    mockConversationCount.mockResolvedValue(4)
    // ...existing upsert/transaction mocks return a setting with automationLevel: 3...

    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ automationLevel: 3 }) }))
    const data = await res.json()

    expect(data.backfillAvailable).toBe(true)
    expect(data.backfillEligibleCount).toBe(4)
  })

  it("omits backfillAvailable when already at level 3+", async () => {
    mockFindUnique.mockResolvedValue({ automationLevel: 4 })

    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ automationLevel: 5 }) }))
    const data = await res.json()

    expect(data.backfillAvailable).toBeUndefined()
  })
})
```

(Add `mockConversationCount` to the file's existing `vi.hoisted()`/`vi.mock("@/lib/prisma")` block, wired to `prisma.conversation.count`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run <located-autopilot-settings-route-test-file> -t "backfill signal"`
Expected: FAIL — response has no `backfillAvailable` field.

- [ ] **Step 3: Add the signal to the route**

In `app/api/autopilot-settings/route.ts`, after the `const [setting] = await prisma.$transaction([...])` block, before `return NextResponse.json({ setting })`, add:

```typescript
  const crossedIntoLevel3 =
    automationLevel !== undefined &&
    automationLevel >= 3 &&
    (existing?.automationLevel ?? 0) < 3

  if (!crossedIntoLevel3) {
    return NextResponse.json({ setting })
  }

  const backfillEligibleCount = await prisma.conversation.count({
    where: { tenantId: session.user.tenantId, status: "needs_reply", draft: null },
  })

  return NextResponse.json({ setting, backfillAvailable: true, backfillEligibleCount })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run <located-autopilot-settings-route-test-file>`
Expected: PASS (all existing tests plus the 2 new ones)

- [ ] **Step 5: Add the banner to the settings form**

In `app/settings/AutopilotSettingsForm.tsx`, add state near the other `useState` declarations (after line 84's `levelError` state):

```typescript
  const [backfillOffer, setBackfillOffer] = useState<{ eligibleCount: number } | null>(null)
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [backfillSummary, setBackfillSummary] = useState<string | null>(null)
```

Modify `handleConfirmLevel` (original lines 141–160) to capture the backfill offer from the response:

```typescript
  async function handleConfirmLevel() {
    if (pendingLevel === null) return
    setLevelSaving(true)
    setLevelError(null)
    try {
      const res = await fetch("/api/autopilot-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automationLevel: pendingLevel }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to change level")
      setCurrentLevel(pendingLevel)
      setPendingLevel(null)
      if (data.backfillAvailable) {
        setBackfillOffer({ eligibleCount: data.backfillEligibleCount ?? 0 })
      }
    } catch (err) {
      setLevelError(err instanceof Error ? err.message : "Failed to change level")
    } finally {
      setLevelSaving(false)
    }
  }

  async function runBackfill(scope: "all" | "last_n") {
    setBackfillRunning(true)
    setBackfillSummary(null)
    try {
      const res = await fetch("/api/autopilot-settings/backfill-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scope === "last_n" ? { scope, n: 10 } : { scope }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Backfill failed")
      const drafted = (data.results ?? []).filter((r: { status: string }) => r.status === "drafted").length
      const skipped = (data.results ?? []).length - drafted
      setBackfillSummary(`Created ${drafted} draft${drafted === 1 ? "" : "s"}, skipped ${skipped} that didn't need a reply.`)
      setBackfillOffer(null)
    } catch (err) {
      setBackfillSummary(err instanceof Error ? err.message : "Backfill failed")
    } finally {
      setBackfillRunning(false)
    }
  }
```

Add the banner JSX immediately after the existing `{levelError && ...}` block (original line 258), before the `{isDisabled && ...}` block:

```tsx
      {backfillOffer && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
          <p className="font-medium">
            Create drafts for your {backfillOffer.eligibleCount} existing conversation
            {backfillOffer.eligibleCount === 1 ? "" : "s"} that need a reply?
          </p>
          <p className="mt-1 text-xs text-slate-500">
            FlowDesk will skip anything that turns out not to need one, like newsletters.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => runBackfill("all")}
              disabled={backfillRunning}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {backfillRunning ? "Working..." : "Create for all"}
            </button>
            <button
              onClick={() => runBackfill("last_n")}
              disabled={backfillRunning}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Last 10 only
            </button>
            <button
              onClick={() => setBackfillOffer(null)}
              disabled={backfillRunning}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {backfillSummary && <p className="text-xs text-slate-600">{backfillSummary}</p>}
```

No new test file for this step — it's a client component with no existing test coverage precedent in this codebase for `AutopilotSettingsForm.tsx` (verify with `find tests -iname "*AutopilotSettingsForm*"`; if one exists, extend it with a React Testing Library interaction test following its established pattern, otherwise rely on Task 11's manual browser verification).

- [ ] **Step 6: Commit**

```bash
git add app/api/autopilot-settings/route.ts app/settings/AutopilotSettingsForm.tsx <located-autopilot-settings-route-test-file>
git commit -m "feat: offer draft backfill when a tenant raises automation level to 3+"
```

---

### Task 11: Full verification pass

**Files:** None (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass, including every file touched in Tasks 1–10.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors. If errors appear in `lib/outlook-*.ts` or `geist` imports unrelated to this change, run `npm install && npx prisma generate` first per the repo's documented environment gotcha, then re-check that remaining errors are none.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 4: Manual browser verification of the backfill banner**

Start the dev server, sign in, navigate to Settings → Automation, switch from Level 2 to Level 3, confirm the banner appears with the correct eligible count, click "Last 10 only," and confirm the summary line renders and drafts appear for eligible conversations (check the FlowDesk dashboard's conversation list for `status: proposed` drafts, or a connected test Gmail account's Drafts folder for `create_draft` writeback jobs to land, allowing for the cron/scheduler's processing interval).

- [ ] **Step 5: Final commit if any fixes were needed during verification**

```bash
git add -A
git commit -m "chore: fix issues found during verification pass"
```
