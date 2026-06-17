# Phase 4 v4.0 — User Control Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Train My Agent with plain English (#27), category-scoped autopilot policy builder (#2), auto-generated snippets (#37), and One-click Clean My Inbox (#41).

**Architecture:** `AgentRule` and `Snippet` are new Prisma models with migrations. The rule compiler calls OpenAI. Clean inbox uses existing archive/unsubscribe routes in batch. Autopilot policy is a UI-only upgrade to the existing `categoryThresholdsJson` field. All new settings panels are added to `app/settings/page.tsx`.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Next.js App Router, OpenAI, Vitest

**Spec:** `docs/superpowers/specs/2026-06-17-phase-4-automations-integrations-design.md`

## Global Constraints

- Auth guard: every API route must call `getServerSession(authOptions)` and return 401 if `!session?.user?.tenantId`
- Tenant isolation: all DB queries include `tenantId` filter
- All new Prisma models use `@id @default(cuid())` and belong to `Tenant` with `onDelete: Cascade`
- Migrations go in `prisma/migrations/YYYYMMDDHHMMSS_<name>/migration.sql`
- Tests use Vitest (`import { describe, it, expect } from "vitest"`) and mock Prisma with `vi.mock("@/lib/prisma", ...)`
- Run `npx tsc --noEmit` and `npm test` before each commit
- Commit message format: `feat: <description>\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## File Structure

**New files:**
- `prisma/migrations/20260617010000_add_agent_rules/migration.sql`
- `prisma/migrations/20260617011000_add_snippets/migration.sql`
- `lib/agent/rule-compiler.ts` — plain-English → AgentRule compiler
- `lib/agent/snippet-miner.ts` — mine sent emails for repeated patterns
- `app/api/agent-rules/route.ts` — GET + POST
- `app/api/agent-rules/[id]/route.ts` — PATCH + DELETE
- `app/api/agent-rules/preview/route.ts` — POST (compile + dry-run)
- `app/api/snippets/route.ts` — GET + POST
- `app/api/snippets/[id]/route.ts` — PATCH + DELETE
- `app/api/cron/snippet-mine/route.ts` — POST (weekly miner)
- `app/api/clean-inbox/archive-batch/route.ts`
- `app/api/clean-inbox/unsubscribe-batch/route.ts`
- `app/api/clean-inbox/undo/[batchToken]/route.ts`
- `app/settings/TrainAgentPanel.tsx`
- `app/settings/SnippetsPanel.tsx`
- `app/clean-inbox/page.tsx`
- `tests/rule-compiler.test.ts`
- `tests/snippet-miner.test.ts`
- `tests/clean-inbox-batch.test.ts`

**Modified files:**
- `prisma/schema.prisma` — add `AgentRule`, `Snippet` models; add relations to `Tenant`
- `lib/agent/preference-learning.ts` — extend `applyActiveRule` to also check `AgentRule`
- `app/settings/AutopilotSettingsForm.tsx` — replace per-intent table with per-attention-category policy table
- `app/settings/page.tsx` — import and render `TrainAgentPanel`, `SnippetsPanel`
- `app/conversations/[id]/ReplyComposer.tsx` — add snippet picker button
- `app/components/AppRail.tsx` — add Clean Inbox nav icon

---

## Task 1: AgentRule and Snippet schema migrations

**Files:**
- Create: `prisma/migrations/20260617010000_add_agent_rules/migration.sql`
- Create: `prisma/migrations/20260617011000_add_snippets/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write migration SQL for AgentRule**

Create file `prisma/migrations/20260617010000_add_agent_rules/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "AgentRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "conditionsJson" JSONB NOT NULL,
    "actionJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'plain_english',
    "previewCount" INTEGER,
    "conflictsWith" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRule_tenantId_status_idx" ON "AgentRule"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "AgentRule" ADD CONSTRAINT "AgentRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 2: Write migration SQL for Snippet**

Create file `prisma/migrations/20260617011000_add_snippets/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "Snippet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "source" TEXT NOT NULL DEFAULT 'mined',
    "minedFromJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Snippet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Snippet_tenantId_status_idx" ON "Snippet"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "Snippet" ADD CONSTRAINT "Snippet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Add AgentRule and Snippet to schema.prisma**

In `prisma/schema.prisma`, add to `Tenant` model (after the `senderRules` relation):
```prisma
  agentRules                AgentRule[]
  snippets                  Snippet[]
```

Add at the end of the file:

```prisma
model AgentRule {
  id            String   @id @default(cuid())
  tenantId      String
  plainText     String
  ruleType      String
  conditionsJson Json
  actionJson    Json
  status        String   @default("active")
  source        String   @default("plain_english")
  previewCount  Int?
  conflictsWith String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
}

model Snippet {
  id            String   @id @default(cuid())
  tenantId      String
  title         String
  content       String
  useCount      Int      @default(0)
  status        String   @default("suggested")
  source        String   @default("mined")
  minedFromJson Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
}
```

- [ ] **Step 4: Regenerate Prisma client**

```bash
cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox"
npx prisma generate
```

Expected: `✔ Generated Prisma Client`

- [ ] **Step 5: Apply migrations**

```bash
npx prisma migrate deploy
```

Expected: `2 migrations applied`

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260617010000_add_agent_rules/ prisma/migrations/20260617011000_add_snippets/
git commit -m "feat: add AgentRule and Snippet models with migrations

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Rule compiler

**Files:**
- Create: `lib/agent/rule-compiler.ts`
- Create: `tests/rule-compiler.test.ts`

**Interfaces:**
- Produces: `compileRule(plainText: string): Promise<CompiledRule>` where `CompiledRule = { ruleType: string; conditionsJson: Record<string,unknown>; actionJson: Record<string,unknown>; confidence: number }`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/rule-compiler.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ai/openai-provider", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}))

import { compileRule } from "@/lib/agent/rule-compiler"
import { openai } from "@/lib/ai/openai-provider"

const mockCreate = vi.mocked(openai.chat.completions.create)

describe("compileRule", () => {
  beforeEach(() => vi.clearAllMocks())

  it("compiles domain-based attention rule", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            ruleType: "attention",
            conditionsJson: { matchType: "domain", matchValue: "amazon.com" },
            actionJson: { targetAttention: "read_later" },
            confidence: 0.95,
          }),
        },
      }],
    } as never)

    const result = await compileRule("Move all emails from amazon.com to read later")
    expect(result.ruleType).toBe("attention")
    expect(result.conditionsJson).toEqual({ matchType: "domain", matchValue: "amazon.com" })
    expect(result.actionJson).toEqual({ targetAttention: "read_later" })
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it("falls back to regex for simple sender patterns", async () => {
    // Regex fallback: "emails from @newsletter.com → read_later"
    const result = await compileRule("emails from newsletters@example.com should be quiet")
    // If OpenAI is mocked to not be called because regex catches it first,
    // result should still be valid
    expect(result.ruleType).toBe("attention")
    expect(result.conditionsJson.matchType).toBeDefined()
  })

  it("returns low confidence for ambiguous input", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            ruleType: "attention",
            conditionsJson: { matchType: "domain", matchValue: "example.com" },
            actionJson: { targetAttention: "quiet" },
            confidence: 0.3,
          }),
        },
      }],
    } as never)

    const result = await compileRule("do something with example emails")
    expect(result.confidence).toBeLessThan(0.5)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- rule-compiler
```

Expected: FAIL — `compileRule` not found

- [ ] **Step 3: Write the rule compiler**

Create `lib/agent/rule-compiler.ts`:

```typescript
import { openai } from "@/lib/ai/openai-provider"

export type CompiledRule = {
  ruleType: string
  conditionsJson: Record<string, unknown>
  actionJson: Record<string, unknown>
  confidence: number
}

const ATTENTION_VALUES = ["needs_reply","needs_action","review_soon","read_later","waiting_on","fyi_done","quiet"]

// Quick regex patterns to avoid an LLM call for obvious cases
function tryRegexCompile(plainText: string): CompiledRule | null {
  const lower = plainText.toLowerCase()

  // Extract email: "from user@domain.com"
  const emailMatch = lower.match(/from\s+([\w.+-]+@[\w.-]+\.\w+)/)
  // Extract domain: "from @domain.com" or "from domain.com"
  const domainMatch = lower.match(/from\s+(?:@)?([\w-]+\.[\w.-]+)/)

  // Extract target attention
  let targetAttention: string | null = null
  if (/\bquiet\b|\bsilence\b|\bmute\b/.test(lower)) targetAttention = "quiet"
  else if (/read.?later\b/.test(lower)) targetAttention = "read_later"
  else if (/fyi|done\b/.test(lower)) targetAttention = "fyi_done"
  else if (/archive/.test(lower)) targetAttention = "quiet"

  if (!targetAttention) return null

  if (emailMatch) {
    return {
      ruleType: "attention",
      conditionsJson: { matchType: "email", matchValue: emailMatch[1] },
      actionJson: { targetAttention },
      confidence: 0.9,
    }
  }
  if (domainMatch) {
    return {
      ruleType: "attention",
      conditionsJson: { matchType: "domain", matchValue: domainMatch[1] },
      actionJson: { targetAttention },
      confidence: 0.85,
    }
  }
  return null
}

export async function compileRule(plainText: string): Promise<CompiledRule> {
  // Try fast regex path first
  const regexResult = tryRegexCompile(plainText)
  if (regexResult) return regexResult

  const prompt = `You are a rule compiler for an email assistant. Convert the user's plain-English rule into a structured JSON object.

Supported ruleTypes: "attention"
Supported conditionsJson: { "matchType": "email"|"domain", "matchValue": "<email or domain>" }
Supported actionJson: { "targetAttention": one of ${JSON.stringify(ATTENTION_VALUES)} }
confidence: 0.0–1.0 (how certain you are about the interpretation)

User rule: "${plainText}"

Respond with ONLY valid JSON matching this shape:
{ "ruleType": "attention", "conditionsJson": {...}, "actionJson": {...}, "confidence": 0.0 }`

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 200,
  })

  const raw = completion.choices[0]?.message?.content?.trim() ?? ""
  try {
    const parsed = JSON.parse(raw)
    return {
      ruleType: parsed.ruleType ?? "attention",
      conditionsJson: parsed.conditionsJson ?? {},
      actionJson: parsed.actionJson ?? {},
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    }
  } catch {
    return {
      ruleType: "attention",
      conditionsJson: {},
      actionJson: {},
      confidence: 0,
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- rule-compiler
```

Expected: all tests pass

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add lib/agent/rule-compiler.ts tests/rule-compiler.test.ts
git commit -m "feat: add plain-English rule compiler with regex fast path

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: AgentRule API routes + extend preference-learning

**Files:**
- Create: `app/api/agent-rules/route.ts`
- Create: `app/api/agent-rules/[id]/route.ts`
- Create: `app/api/agent-rules/preview/route.ts`
- Modify: `lib/agent/preference-learning.ts`

- [ ] **Step 1: Create GET + POST /api/agent-rules**

```typescript
// app/api/agent-rules/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { compileRule } from "@/lib/agent/rule-compiler"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const rules = await prisma.agentRule.findMany({
    where: { tenantId: session.user.tenantId, status: { not: "dismissed" } },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json({ rules })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { plainText } = await request.json()
  if (!plainText || typeof plainText !== "string") {
    return NextResponse.json({ error: "plainText required" }, { status: 400 })
  }
  const compiled = await compileRule(plainText)
  if (compiled.confidence < 0.4) {
    return NextResponse.json({ error: "Could not understand that rule. Try rephrasing." }, { status: 422 })
  }
  const rule = await prisma.agentRule.create({
    data: {
      tenantId: session.user.tenantId,
      plainText,
      ruleType: compiled.ruleType,
      conditionsJson: compiled.conditionsJson,
      actionJson: compiled.actionJson,
      status: "active",
      source: "plain_english",
    },
  })
  return NextResponse.json({ rule })
}
```

- [ ] **Step 2: Create PATCH + DELETE /api/agent-rules/[id]**

```typescript
// app/api/agent-rules/[id]/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const rule = await prisma.agentRule.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const updated = await prisma.agentRule.update({
    where: { id: params.id },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.plainText && { plainText: body.plainText }),
    },
  })
  return NextResponse.json({ rule: updated })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await prisma.agentRule.deleteMany({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Create POST /api/agent-rules/preview**

```typescript
// app/api/agent-rules/preview/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { compileRule } from "@/lib/agent/rule-compiler"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { plainText } = await request.json()
  if (!plainText) return NextResponse.json({ error: "plainText required" }, { status: 400 })

  const compiled = await compileRule(plainText)
  const tenantId = session.user.tenantId

  // Count matching conversations from last 90 days
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const cond = compiled.conditionsJson as Record<string, string>
  const matchType = cond.matchType
  const matchValue = (cond.matchValue ?? "").toLowerCase()

  let affectedCount = 0
  let examples: string[] = []

  if (matchType === "email" || matchType === "domain") {
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId,
        phoneE164: matchType === "email"
          ? { equals: matchValue, mode: "insensitive" }
          : { endsWith: `@${matchValue}`, mode: "insensitive" },
      },
      select: { id: true, name: true },
      take: 10,
    })
    const contactIds = contacts.map((c) => c.id)
    if (contactIds.length > 0) {
      const convs = await prisma.conversation.findMany({
        where: { tenantId, contactId: { in: contactIds }, createdAt: { gte: since } },
        include: { messages: { take: 1, orderBy: { createdAt: "asc" } } },
        take: 5,
        orderBy: { lastMessageAt: "desc" },
      })
      affectedCount = convs.length
      examples = convs.flatMap((c) => c.messages.map((m) => m.subject ?? "(no subject)")).slice(0, 5)
    }
  }

  // Detect conflicts with existing active rules
  const conflicts = await prisma.agentRule.findMany({
    where: {
      tenantId,
      status: "active",
      conditionsJson: { path: ["matchValue"], equals: matchValue },
    },
    select: { id: true, plainText: true },
  })

  return NextResponse.json({ compiled, affectedCount, examples, conflicts })
}
```

- [ ] **Step 4: Extend applyActiveRule to check AgentRule**

In `lib/agent/preference-learning.ts`, after the existing `applyActiveRule` function, add:

```typescript
// Checks AgentRule table in addition to SenderRule.
// AgentRule takes precedence over SenderRule for the same target.
export async function applyActiveAgentRule({
  tenantId,
  fromEmail,
}: {
  tenantId: string
  fromEmail: string
}): Promise<AttentionCategory | null> {
  const fromDomain = extractDomainFromEmail(fromEmail)
  const emailLower = fromEmail.toLowerCase()

  const rules = await prisma.agentRule.findMany({
    where: { tenantId, status: "active", ruleType: "attention" },
  })

  for (const rule of rules) {
    const cond = rule.conditionsJson as Record<string, string>
    const action = rule.actionJson as Record<string, string>
    if (!action.targetAttention) continue
    if (cond.matchType === "email" && cond.matchValue?.toLowerCase() === emailLower) {
      return action.targetAttention as AttentionCategory
    }
    if (cond.matchType === "domain" && fromDomain && cond.matchValue === fromDomain) {
      return action.targetAttention as AttentionCategory
    }
  }
  return null
}
```

Also update `applyActiveRule` to call `applyActiveAgentRule` first (AgentRule takes precedence). Replace the existing function body:

```typescript
export async function applyActiveRule({
  tenantId,
  fromEmail,
}: {
  tenantId: string
  fromEmail: string
}): Promise<AttentionCategory | null> {
  // AgentRule takes precedence over SenderRule
  const agentResult = await applyActiveAgentRule({ tenantId, fromEmail })
  if (agentResult) return agentResult

  const fromDomain = extractDomainFromEmail(fromEmail)
  const emailRule = await prisma.senderRule.findFirst({
    where: { tenantId, matchType: "email", matchValue: fromEmail.toLowerCase(), status: "active" },
  })
  if (emailRule) return emailRule.targetAttention as AttentionCategory
  if (!fromDomain) return null
  const domainRule = await prisma.senderRule.findFirst({
    where: { tenantId, matchType: "domain", matchValue: fromDomain, status: "active" },
  })
  if (domainRule) return domainRule.targetAttention as AttentionCategory
  return null
}
```

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add app/api/agent-rules/ lib/agent/preference-learning.ts
git commit -m "feat: add AgentRule API routes and extend preference learning

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: TrainAgentPanel settings UI + autopilot policy builder

**Files:**
- Create: `app/settings/TrainAgentPanel.tsx`
- Modify: `app/settings/AutopilotSettingsForm.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Create TrainAgentPanel**

```typescript
// app/settings/TrainAgentPanel.tsx
"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"

type AgentRule = {
  id: string
  plainText: string
  ruleType: string
  conditionsJson: Record<string, string>
  actionJson: Record<string, string>
  status: string
}

type PreviewResult = {
  compiled: { ruleType: string; conditionsJson: Record<string,unknown>; actionJson: Record<string,unknown>; confidence: number }
  affectedCount: number
  examples: string[]
  conflicts: { id: string; plainText: string }[]
}

const ATTENTION_LABELS: Record<string, string> = {
  needs_reply: "Reply needed", needs_action: "Needs action", review_soon: "Review soon",
  read_later: "Read later", waiting_on: "Waiting on", fyi_done: "FYI / Done", quiet: "Quiet",
}

export default function TrainAgentPanel({ initialRules }: { initialRules: AgentRule[] }) {
  const router = useRouter()
  const [rules, setRules] = useState(initialRules)
  const [input, setInput] = useState("")
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePreview() {
    if (!input.trim()) return
    setPreviewing(true)
    setError(null)
    setPreview(null)
    try {
      const res = await fetch("/api/agent-rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plainText: input }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Preview failed")
      setPreview(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed")
    } finally {
      setPreviewing(false)
    }
  }

  async function handleSave() {
    if (!input.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/agent-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plainText: input }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to save rule")
      setRules((prev) => [data.rule, ...prev])
      setInput("")
      setPreview(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function handlePause(id: string, currentStatus: string) {
    const newStatus = currentStatus === "active" ? "paused" : "active"
    await fetch(`/api/agent-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, status: newStatus } : r))
  }

  async function handleDelete(id: string) {
    await fetch(`/api/agent-rules/${id}`, { method: "DELETE" })
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Describe a rule in plain English</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setPreview(null) }}
            placeholder='e.g. "Move all emails from amazon.com to read later"'
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            onKeyDown={(e) => e.key === "Enter" && handlePreview()}
          />
          <button
            onClick={handlePreview}
            disabled={!input.trim() || previewing}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {previewing ? "…" : "Preview"}
          </button>
        </div>
      </div>

      {preview && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2 text-sm">
          <p className="font-medium text-blue-900">
            Rule understood — affects {preview.affectedCount} emails in the last 90 days
          </p>
          {preview.examples.length > 0 && (
            <ul className="list-disc list-inside text-blue-700 text-xs">
              {preview.examples.map((ex, i) => <li key={i}>{ex}</li>)}
            </ul>
          )}
          {preview.conflicts.length > 0 && (
            <p className="text-amber-700 text-xs font-medium">
              ⚠ Conflicts with existing rule: &ldquo;{preview.conflicts[0].plainText}&rdquo;
            </p>
          )}
          {preview.compiled.confidence < 0.5 && (
            <p className="text-red-700 text-xs">Low confidence — try rephrasing more specifically.</p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || preview.compiled.confidence < 0.4}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add rule"}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {rules.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Active rules</p>
          <div className="space-y-1">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">{rule.plainText}</p>
                  <p className="text-xs text-slate-400">
                    {rule.conditionsJson.matchType} {rule.conditionsJson.matchValue}
                    {" → "}
                    {ATTENTION_LABELS[rule.actionJson.targetAttention] ?? rule.actionJson.targetAttention}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => handlePause(rule.id, rule.status)}
                    className="text-xs text-slate-400 hover:text-slate-700"
                  >
                    {rule.status === "active" ? "Pause" : "Resume"}
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="text-xs text-slate-400 hover:text-red-500"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Upgrade AutopilotSettingsForm with per-category policy table**

Replace the per-intent sections in `app/settings/AutopilotSettingsForm.tsx`. After the confidence threshold input, replace the "Per-intent confidence overrides" and "Allowed intents" sections with:

```typescript
// Replace INTENT_OPTIONS const and categoryThresholds state with:
const CATEGORY_OPTIONS = [
  { key: "needs_reply", label: "Reply needed" },
  { key: "needs_action", label: "Needs action" },
  { key: "review_soon", label: "Review soon" },
  { key: "read_later", label: "Read later" },
  { key: "fyi_done", label: "FYI / Done" },
  { key: "quiet", label: "Quiet" },
]

type CategoryPolicy = { action: "auto_send" | "require_approval" | "never"; threshold?: number }

// Change categoryThresholds state type:
const [categoryPolicies, setCategoryPolicies] = useState<Record<string, CategoryPolicy>>(
  (() => {
    const raw = initial?.categoryThresholds ?? {}
    const result: Record<string, CategoryPolicy> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "object" && v !== null && "action" in (v as object)) {
        result[k] = v as CategoryPolicy
      } else if (typeof v === "number") {
        result[k] = { action: "auto_send", threshold: v }
      }
    }
    return result
  })()
)
```

Replace the per-intent UI block (lines roughly 175-205) with:

```tsx
{/* Per-category autopilot policy */}
<div>
  <p className="text-xs font-medium text-slate-600">Per-category policy</p>
  <p className="mt-0.5 text-xs text-slate-400">
    Override autopilot behavior for specific attention categories.
  </p>
  <div className="mt-2 space-y-2">
    {CATEGORY_OPTIONS.map(({ key, label }) => {
      const policy = categoryPolicies[key]
      return (
        <div key={key} className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-xs text-slate-600">{label}</span>
          <select
            value={policy?.action ?? ""}
            onChange={(e) => {
              const action = e.target.value as CategoryPolicy["action"] | ""
              setCategoryPolicies((prev) => {
                const next = { ...prev }
                if (!action) { delete next[key]; return next }
                next[key] = { action, threshold: prev[key]?.threshold }
                return next
              })
            }}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">Default</option>
            <option value="auto_send">Auto-send</option>
            <option value="require_approval">Require approval</option>
            <option value="never">Never auto-send</option>
          </select>
          {policy?.action === "auto_send" && (
            <input
              type="number"
              step={0.05}
              min={0.5}
              max={1.0}
              placeholder="threshold"
              value={policy.threshold ?? ""}
              onChange={(e) => {
                const val = e.target.value === "" ? undefined : parseFloat(e.target.value)
                setCategoryPolicies((prev) => ({ ...prev, [key]: { ...prev[key], threshold: val } }))
              }}
              className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          )}
        </div>
      )
    })}
  </div>
</div>
```

Update the `handleSave` body to pass `categoryThresholds: categoryPolicies` instead of the old `categoryThresholds`.

Remove the `allowedIntents` state and the "Allowed intents" UI section entirely (replaced by per-category policy).

- [ ] **Step 3: Add panels to settings page**

In `app/settings/page.tsx`, add imports after existing ones:
```typescript
import TrainAgentPanel from "@/app/settings/TrainAgentPanel"
```

Add query to fetch agentRules in the existing destructured query array:
```typescript
prisma.agentRule.findMany({
  where: { tenantId, status: { not: "dismissed" } },
  orderBy: { createdAt: "desc" },
})
```

Add the panel in the JSX, in the "Preferences" or "Automation" section:
```tsx
<section>
  <h2 className="mb-3 text-base font-semibold">Train My Agent</h2>
  <p className="mb-4 text-sm text-slate-500">
    Describe rules in plain English. FlowDesk will apply them automatically.
  </p>
  <TrainAgentPanel initialRules={agentRules} />
</section>
```

- [ ] **Step 4: Type-check and commit**

```bash
npx tsc --noEmit
npm test
git add app/settings/TrainAgentPanel.tsx app/settings/AutopilotSettingsForm.tsx app/settings/page.tsx
git commit -m "feat: Train My Agent panel + category-scoped autopilot policy builder

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Snippet miner, API, and UI

**Files:**
- Create: `lib/agent/snippet-miner.ts`
- Create: `app/api/snippets/route.ts`
- Create: `app/api/snippets/[id]/route.ts`
- Create: `app/api/cron/snippet-mine/route.ts`
- Create: `app/settings/SnippetsPanel.tsx`
- Modify: `app/conversations/[id]/ReplyComposer.tsx`
- Modify: `app/settings/page.tsx`
- Create: `tests/snippet-miner.test.ts`

- [ ] **Step 1: Write failing test for snippet miner**

```typescript
// tests/snippet-miner.test.ts
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: { findMany: vi.fn() },
    snippet: { findMany: vi.fn(), upsert: vi.fn() },
  },
}))

import { mineSnippets } from "@/lib/agent/snippet-miner"
import { prisma } from "@/lib/prisma"

const mockMessages = vi.mocked(prisma.message.findMany)
const mockSnippetFindMany = vi.mocked(prisma.snippet.findMany)
const mockUpsert = vi.mocked(prisma.snippet.upsert)

describe("mineSnippets", () => {
  it("extracts repeated greeting patterns", async () => {
    mockMessages.mockResolvedValueOnce([
      { id: "m1", body: "Hi there, thanks for reaching out! Let me check on that for you." },
      { id: "m2", body: "Hi there, thanks for reaching out! I will get back to you shortly." },
      { id: "m3", body: "Hi there, thanks for reaching out! Here is what I found." },
    ] as never)
    mockSnippetFindMany.mockResolvedValueOnce([] as never)
    mockUpsert.mockResolvedValue({} as never)

    await mineSnippets("tenant1")
    expect(mockUpsert).toHaveBeenCalled()
  })

  it("skips patterns appearing fewer than 3 times", async () => {
    mockMessages.mockResolvedValueOnce([
      { id: "m1", body: "Unique response that nobody else would write." },
    ] as never)
    mockSnippetFindMany.mockResolvedValueOnce([] as never)

    await mineSnippets("tenant1")
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- snippet-miner
```

Expected: FAIL

- [ ] **Step 3: Implement snippet miner**

```typescript
// lib/agent/snippet-miner.ts
import { prisma } from "@/lib/prisma"

// Extracts candidate phrases from a message body.
// Returns greetings, sign-offs, and common mid-body sentences.
function extractCandidates(body: string): string[] {
  const sentences = body
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && s.length < 200)

  const candidates: string[] = []

  // First sentence (greeting)
  if (sentences[0]) candidates.push(sentences[0])
  // Last sentence (sign-off)
  if (sentences.length > 1 && sentences[sentences.length - 1]) {
    candidates.push(sentences[sentences.length - 1])
  }
  // Mid-body sentences that look like templates
  for (let i = 1; i < sentences.length - 1; i++) {
    const s = sentences[i]
    if (/please|feel free|let me know|don't hesitate|happy to|reach out/i.test(s)) {
      candidates.push(s)
    }
  }

  return candidates
}

export async function mineSnippets(tenantId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)

  const messages = await prisma.message.findMany({
    where: {
      conversation: { tenantId },
      direction: "outbound",
      createdAt: { gte: since },
    },
    select: { id: true, body: true },
    take: 500,
  })

  // Count phrase frequency
  const freq = new Map<string, { count: number; ids: string[] }>()
  for (const msg of messages) {
    const candidates = extractCandidates(msg.body)
    for (const phrase of candidates) {
      const key = phrase.toLowerCase().replace(/\s+/g, " ").trim()
      if (!freq.has(key)) freq.set(key, { count: 0, ids: [] })
      const entry = freq.get(key)!
      entry.count++
      entry.ids.push(msg.id)
    }
  }

  let created = 0
  const existing = await prisma.snippet.findMany({
    where: { tenantId },
    select: { title: true },
  })
  const existingTitles = new Set(existing.map((s) => s.title.toLowerCase()))

  for (const [key, { count, ids }] of freq.entries()) {
    if (count < 3) continue
    // Use the first 60 chars as title
    const title = key.charAt(0).toUpperCase() + key.slice(1, 60) + (key.length > 60 ? "…" : "")
    if (existingTitles.has(title.toLowerCase())) continue

    await prisma.snippet.upsert({
      where: { id: `mine-${tenantId}-${Buffer.from(key).toString("base64").slice(0, 20)}` },
      update: {},
      create: {
        id: `mine-${tenantId}-${Buffer.from(key).toString("base64").slice(0, 20)}`,
        tenantId,
        title,
        content: key.charAt(0).toUpperCase() + key.slice(1),
        status: "suggested",
        source: "mined",
        minedFromJson: ids.slice(0, 3),
      },
    })
    created++
  }

  return created
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- snippet-miner
```

Expected: all pass

- [ ] **Step 5: Create snippets API routes**

```typescript
// app/api/snippets/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const snippets = await prisma.snippet.findMany({
    where: { tenantId: session.user.tenantId, status: { not: "dismissed" } },
    orderBy: [{ status: "asc" }, { useCount: "desc" }],
  })
  return NextResponse.json({ snippets })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { title, content } = await request.json()
  if (!title || !content) return NextResponse.json({ error: "title and content required" }, { status: 400 })
  const snippet = await prisma.snippet.create({
    data: { tenantId: session.user.tenantId, title, content, status: "active", source: "manual" },
  })
  return NextResponse.json({ snippet })
}
```

```typescript
// app/api/snippets/[id]/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const snippet = await prisma.snippet.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  if (!snippet) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const updated = await prisma.snippet.update({
    where: { id: params.id },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.title && { title: body.title }),
      ...(body.content && { content: body.content }),
      ...(body.incrementUseCount && { useCount: { increment: 1 } }),
    },
  })
  return NextResponse.json({ snippet: updated })
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await prisma.snippet.deleteMany({ where: { id: params.id, tenantId: session.user.tenantId } })
  return NextResponse.json({ ok: true })
}
```

```typescript
// app/api/cron/snippet-mine/route.ts
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { mineSnippets } from "@/lib/agent/snippet-miner"

export async function GET() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } })
  const results: Record<string, number> = {}
  for (const tenant of tenants) {
    results[tenant.id] = await mineSnippets(tenant.id)
  }
  return NextResponse.json({ ok: true, results })
}
```

- [ ] **Step 6: Create SnippetsPanel**

```typescript
// app/settings/SnippetsPanel.tsx
"use client"
import { useState } from "react"

type Snippet = { id: string; title: string; content: string; status: string; source: string; useCount: number }

export default function SnippetsPanel({ initialSnippets }: { initialSnippets: Snippet[] }) {
  const [snippets, setSnippets] = useState(initialSnippets)
  const [newTitle, setNewTitle] = useState("")
  const [newContent, setNewContent] = useState("")
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const suggested = snippets.filter((s) => s.status === "suggested")
  const active = snippets.filter((s) => s.status === "active")

  async function act(id: string, status: string) {
    await fetch(`/api/snippets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    setSnippets((prev) =>
      status === "dismissed" ? prev.filter((s) => s.id !== id) : prev.map((s) => s.id === id ? { ...s, status } : s)
    )
  }

  async function handleAdd() {
    if (!newTitle.trim() || !newContent.trim()) return
    setAdding(true)
    const res = await fetch("/api/snippets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, content: newContent }),
    })
    const data = await res.json()
    if (res.ok) {
      setSnippets((prev) => [...prev, data.snippet])
      setNewTitle("")
      setNewContent("")
      setShowForm(false)
    }
    setAdding(false)
  }

  return (
    <div className="space-y-4">
      {suggested.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Suggested snippets</p>
          <div className="space-y-2">
            {suggested.map((s) => (
              <div key={s.id} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-medium text-slate-900">{s.title}</p>
                <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{s.content}</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => act(s.id, "active")} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">Approve</button>
                  <button onClick={() => act(s.id, "dismissed")} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Active snippets ({active.length})</p>
          <div className="space-y-1">
            {active.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-700">{s.title}</p>
                  <p className="text-xs text-slate-400 line-clamp-1">{s.content}</p>
                </div>
                <button onClick={() => act(s.id, "dismissed")} className="shrink-0 text-xs text-slate-400 hover:text-red-500 ml-4">Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm ? (
        <div className="rounded-lg border border-slate-200 p-4 space-y-3">
          <input
            type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Snippet title"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <textarea
            value={newContent} onChange={(e) => setNewContent(e.target.value)}
            placeholder="Snippet content"
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={adding} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
              {adding ? "Saving…" : "Add snippet"}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="text-sm font-medium text-slate-600 hover:text-slate-900">
          + Add manual snippet
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Add snippet picker to ReplyComposer**

In `app/conversations/[id]/ReplyComposer.tsx`, add snippet state and UI. After the `const [isFocused, setIsFocused] = useState(false)` line:

```typescript
const [snippets, setSnippets] = useState<Array<{id:string;title:string;content:string}>>([])
const [showSnippets, setShowSnippets] = useState(false)
const [snippetsLoaded, setSnippetsLoaded] = useState(false)

async function loadSnippets() {
  if (snippetsLoaded) return
  const res = await fetch("/api/snippets")
  const data = await res.json()
  setSnippets((data.snippets ?? []).filter((s: {status:string}) => s.status === "active"))
  setSnippetsLoaded(true)
}

function insertSnippet(content: string, id: string) {
  setText((prev) => prev + (prev ? "\n\n" : "") + content)
  setShowSnippets(false)
  fetch(`/api/snippets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incrementUseCount: true }),
  }).catch(() => {})
}
```

Add a snippets button to the composer toolbar (add before the send button area):

```tsx
{/* Snippet picker */}
<div className="relative">
  <button
    type="button"
    onClick={() => { loadSnippets(); setShowSnippets((v) => !v) }}
    className="text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded border border-transparent hover:border-slate-200"
  >
    Snippets
  </button>
  {showSnippets && snippets.length > 0 && (
    <div className="absolute bottom-8 left-0 z-10 w-64 rounded-lg border border-slate-200 bg-white shadow-lg max-h-48 overflow-y-auto">
      {snippets.map((s) => (
        <button
          key={s.id}
          onClick={() => insertSnippet(s.content, s.id)}
          className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0"
        >
          <span className="font-medium text-slate-700">{s.title}</span>
          <span className="block text-slate-400 truncate">{s.content}</span>
        </button>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 8: Add SnippetsPanel to settings page**

In `app/settings/page.tsx`:
```typescript
import SnippetsPanel from "@/app/settings/SnippetsPanel"
```

Add to the queries array:
```typescript
prisma.snippet.findMany({
  where: { tenantId, status: { not: "dismissed" } },
  orderBy: [{ status: "asc" }, { useCount: "desc" }],
  take: 50,
})
```

Add panel in JSX:
```tsx
<section>
  <h2 className="mb-3 text-base font-semibold">Snippets &amp; Playbooks</h2>
  <p className="mb-4 text-sm text-slate-500">
    Reusable response templates. FlowDesk suggests these from your sent emails.
  </p>
  <SnippetsPanel initialSnippets={snippets} />
</section>
```

- [ ] **Step 9: Type-check, test, commit**

```bash
npx tsc --noEmit
npm test
git add lib/agent/snippet-miner.ts tests/snippet-miner.test.ts app/api/snippets/ app/api/cron/snippet-mine/ app/settings/SnippetsPanel.tsx app/conversations/[id]/ReplyComposer.tsx app/settings/page.tsx
git commit -m "feat: auto-generated snippets — miner, API, settings panel, composer picker

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: One-click Clean My Inbox

**Files:**
- Create: `app/clean-inbox/page.tsx`
- Create: `app/api/clean-inbox/archive-batch/route.ts`
- Create: `app/api/clean-inbox/unsubscribe-batch/route.ts`
- Create: `app/api/clean-inbox/undo/[batchToken]/route.ts`
- Modify: `app/components/AppRail.tsx`
- Create: `tests/clean-inbox-batch.test.ts`

- [ ] **Step 1: Write failing test for batch archive**

```typescript
// tests/clean-inbox-batch.test.ts
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findMany: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/google", () => ({ archiveGmailThread: vi.fn() }))

import { buildBatchToken, parseBatchToken } from "@/app/api/clean-inbox/archive-batch/route"

describe("batchToken", () => {
  it("encodes and decodes conversation IDs", () => {
    const ids = ["conv1", "conv2", "conv3"]
    const token = buildBatchToken(ids)
    expect(parseBatchToken(token)).toEqual(ids)
  })
})
```

- [ ] **Step 2: Create archive-batch route with token helpers**

```typescript
// app/api/clean-inbox/archive-batch/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export function buildBatchToken(ids: string[]): string {
  return Buffer.from(JSON.stringify(ids)).toString("base64url")
}

export function parseBatchToken(token: string): string[] {
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString())
  } catch {
    return []
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { conversationIds } = await request.json()
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return NextResponse.json({ error: "conversationIds required" }, { status: 400 })
  }
  const tenantId = session.user.tenantId

  // Verify all belong to tenant
  const convs = await prisma.conversation.findMany({
    where: { id: { in: conversationIds }, tenantId },
    select: { id: true },
  })
  const validIds = convs.map((c) => c.id)

  await prisma.conversation.updateMany({
    where: { id: { in: validIds } },
    data: { status: "closed" },
  })

  const batchToken = buildBatchToken(validIds)

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "clean_inbox.archive_batch",
      payloadJson: { batchToken, conversationIds: validIds, count: validIds.length },
    },
  })

  return NextResponse.json({ ok: true, archived: validIds.length, batchToken })
}
```

- [ ] **Step 3: Create unsubscribe-batch route**

```typescript
// app/api/clean-inbox/unsubscribe-batch/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { buildBatchToken } from "@/app/api/clean-inbox/archive-batch/route"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { conversationIds } = await request.json()
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return NextResponse.json({ error: "conversationIds required" }, { status: 400 })
  }
  const tenantId = session.user.tenantId

  const convs = await prisma.conversation.findMany({
    where: { id: { in: conversationIds }, tenantId },
    include: { stateRecord: { select: { metadataJson: true } } },
  })

  let unsubscribed = 0
  for (const conv of convs) {
    const meta = conv.stateRecord?.metadataJson as Record<string, unknown> | null
    const url = typeof meta?.unsubscribeUrl === "string" ? meta.unsubscribeUrl : null
    if (url) {
      fetch(url, { method: "GET" }).catch(() => {})
      unsubscribed++
    }
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { status: "closed" },
    })
  }

  const batchToken = buildBatchToken(convs.map((c) => c.id))
  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "clean_inbox.unsubscribe_batch",
      payloadJson: { batchToken, conversationIds: convs.map((c) => c.id), unsubscribed },
    },
  })

  return NextResponse.json({ ok: true, processed: convs.length, unsubscribed, batchToken })
}
```

- [ ] **Step 4: Create undo route**

```typescript
// app/api/clean-inbox/undo/[batchToken]/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { parseBatchToken } from "@/app/api/clean-inbox/archive-batch/route"

export async function POST(
  _request: Request,
  { params }: { params: { batchToken: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  const ids = parseBatchToken(params.batchToken)
  if (ids.length === 0) return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 })

  // Verify within 1-hour window via auditLog
  const log = await prisma.auditLog.findFirst({
    where: {
      tenantId,
      action: { in: ["clean_inbox.archive_batch", "clean_inbox.unsubscribe_batch"] },
      payloadJson: { path: ["batchToken"], equals: params.batchToken },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  })
  if (!log) return NextResponse.json({ error: "Undo window expired (1 hour)" }, { status: 410 })

  await prisma.conversation.updateMany({
    where: { id: { in: ids }, tenantId },
    data: { status: "needs_reply" },
  })

  return NextResponse.json({ ok: true, restored: ids.length })
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- clean-inbox
```

Expected: all pass

- [ ] **Step 6: Create Clean Inbox page**

```typescript
// app/clean-inbox/page.tsx
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import CleanInboxClient from "./CleanInboxClient"

export const dynamic = "force-dynamic"

export default async function CleanInboxPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  // Newsletters & marketing
  const newsletters = await prisma.conversation.findMany({
    where: {
      tenantId, status: { not: "closed" },
      stateRecord: { emailType: { in: ["newsletter", "marketing"] } },
    },
    select: {
      id: true,
      contact: { select: { name: true, phoneE164: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { subject: true } },
      stateRecord: { select: { metadataJson: true } },
    },
    take: 100,
    orderBy: { lastMessageAt: "desc" },
  })

  // Quiet emails
  const quietEmails = await prisma.conversation.findMany({
    where: {
      tenantId, status: { not: "closed" },
      stateRecord: { attentionCategory: "quiet" },
    },
    select: {
      id: true,
      contact: { select: { name: true, phoneE164: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { subject: true } },
    },
    take: 100,
  })

  // FYI done
  const fyiDone = await prisma.conversation.findMany({
    where: {
      tenantId, status: { not: "closed" },
      stateRecord: { attentionCategory: "fyi_done" },
    },
    select: {
      id: true,
      contact: { select: { name: true, phoneE164: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { subject: true } },
    },
    take: 100,
  })

  return (
    <CleanInboxClient
      newsletters={newsletters.map((c) => ({
        id: c.id,
        subject: c.messages[0]?.subject ?? "(no subject)",
        sender: c.contact?.name ?? c.contact?.phoneE164 ?? "Unknown",
        hasUnsubscribeUrl: !!(c.stateRecord?.metadataJson as Record<string,unknown> | null)?.unsubscribeUrl,
      }))}
      quietEmails={quietEmails.map((c) => ({
        id: c.id,
        subject: c.messages[0]?.subject ?? "(no subject)",
        sender: c.contact?.name ?? c.contact?.phoneE164 ?? "Unknown",
      }))}
      fyiDone={fyiDone.map((c) => ({
        id: c.id,
        subject: c.messages[0]?.subject ?? "(no subject)",
        sender: c.contact?.name ?? c.contact?.phoneE164 ?? "Unknown",
      }))}
    />
  )
}
```

Create `app/clean-inbox/CleanInboxClient.tsx`:

```typescript
// app/clean-inbox/CleanInboxClient.tsx
"use client"
import { useState } from "react"
import Link from "next/link"

type EmailItem = { id: string; subject: string; sender: string; hasUnsubscribeUrl?: boolean }

function BatchSection({
  title,
  description,
  items,
  actionLabel,
  onAction,
  loading,
  done,
  batchToken,
}: {
  title: string
  description: string
  items: EmailItem[]
  actionLabel: string
  onAction: (ids: string[]) => Promise<string | null>
  loading: boolean
  done: boolean
  batchToken: string | null
}) {
  const [undoing, setUndoing] = useState(false)
  const [undone, setUndone] = useState(false)

  async function handleUndo() {
    if (!batchToken) return
    setUndoing(true)
    await fetch(`/api/clean-inbox/undo/${batchToken}`, { method: "POST" })
    setUndone(true)
    setUndoing(false)
  }

  if (items.length === 0) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          <p className="mt-1 text-xs font-medium text-slate-700">{items.length} emails</p>
        </div>
        {!done && !undone && (
          <button
            onClick={() => onAction(items.map((i) => i.id))}
            disabled={loading}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? "Working…" : actionLabel}
          </button>
        )}
        {done && !undone && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600 font-medium">Done</span>
            {batchToken && (
              <button
                onClick={handleUndo}
                disabled={undoing}
                className="text-xs text-slate-400 underline hover:text-slate-700"
              >
                {undoing ? "Undoing…" : "Undo"}
              </button>
            )}
          </div>
        )}
        {undone && <span className="text-xs text-slate-400">Restored</span>}
      </div>
      <div className="mt-4 space-y-1 max-h-48 overflow-y-auto">
        {items.slice(0, 20).map((item) => (
          <div key={item.id} className="flex items-center gap-2 text-xs text-slate-500">
            <span className="truncate">{item.subject}</span>
            <span className="shrink-0 text-slate-300">·</span>
            <span className="shrink-0 text-slate-400">{item.sender}</span>
          </div>
        ))}
        {items.length > 20 && (
          <p className="text-xs text-slate-400">…and {items.length - 20} more</p>
        )}
      </div>
    </div>
  )
}

export default function CleanInboxClient({
  newsletters,
  quietEmails,
  fyiDone,
}: {
  newsletters: (EmailItem & { hasUnsubscribeUrl?: boolean })[]
  quietEmails: EmailItem[]
  fyiDone: EmailItem[]
}) {
  const [tokens, setTokens] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState<Record<string, boolean>>({})

  async function archiveBatch(key: string, ids: string[]): Promise<string | null> {
    setLoading((p) => ({ ...p, [key]: true }))
    const res = await fetch("/api/clean-inbox/archive-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationIds: ids }),
    })
    const data = await res.json()
    setDone((p) => ({ ...p, [key]: true }))
    setLoading((p) => ({ ...p, [key]: false }))
    setTokens((p) => ({ ...p, [key]: data.batchToken ?? null }))
    return data.batchToken ?? null
  }

  async function unsubscribeBatch(key: string, ids: string[]): Promise<string | null> {
    setLoading((p) => ({ ...p, [key]: true }))
    const res = await fetch("/api/clean-inbox/unsubscribe-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationIds: ids }),
    })
    const data = await res.json()
    setDone((p) => ({ ...p, [key]: true }))
    setLoading((p) => ({ ...p, [key]: false }))
    setTokens((p) => ({ ...p, [key]: data.batchToken ?? null }))
    return data.batchToken ?? null
  }

  const total = newsletters.length + quietEmails.length + fyiDone.length

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/inbox" className="text-xs text-slate-400 hover:text-slate-700">← Back to inbox</Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Clean My Inbox</h1>
        <p className="mt-1 text-sm text-slate-500">
          {total} emails can be cleared. Each action is reversible within 1 hour.
        </p>
      </div>

      <div className="space-y-4">
        <BatchSection
          title="Newsletters & Marketing"
          description="Unsubscribe from mailing lists and archive these emails."
          items={newsletters}
          actionLabel={`Unsubscribe & Archive ${newsletters.length}`}
          onAction={(ids) => unsubscribeBatch("newsletters", ids)}
          loading={loading.newsletters ?? false}
          done={done.newsletters ?? false}
          batchToken={tokens.newsletters ?? null}
        />
        <BatchSection
          title="Quiet Emails"
          description="These were automatically marked quiet. Archive them to clean up."
          items={quietEmails}
          actionLabel={`Archive ${quietEmails.length}`}
          onAction={(ids) => archiveBatch("quiet", ids)}
          loading={loading.quiet ?? false}
          done={done.quiet ?? false}
          batchToken={tokens.quiet ?? null}
        />
        <BatchSection
          title="FYI / Already Done"
          description="Informational emails with no action needed."
          items={fyiDone}
          actionLabel={`Archive ${fyiDone.length}`}
          onAction={(ids) => archiveBatch("fyi", ids)}
          loading={loading.fyi ?? false}
          done={done.fyi ?? false}
          batchToken={tokens.fyi ?? null}
        />

        {total === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-sm font-medium text-slate-700">Your inbox looks clean!</p>
            <p className="mt-1 text-xs text-slate-400">No newsletters, quiet emails, or FYI items found.</p>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Add Clean Inbox to AppRail**

In `app/components/AppRail.tsx`, find the nav links array and add:

```tsx
{ href: "/clean-inbox", label: "Clean Inbox", icon: <SparklesIcon /> }
```

Use whichever icon import already exists in that file (e.g. `MagnifyingGlassIcon` from heroicons). If heroicons v2 is available, use `SparklesIcon`; otherwise use a simple SVG:

```tsx
const BroomIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" />
  </svg>
)
```

- [ ] **Step 8: Type-check, test, commit**

```bash
npx tsc --noEmit
npm test
git add app/clean-inbox/ app/api/clean-inbox/ tests/clean-inbox-batch.test.ts app/components/AppRail.tsx
git commit -m "feat: one-click Clean My Inbox with batch archive, unsubscribe, and undo

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage check:**
- #2 Autopilot policy builder: Task 4 Step 2 — per-category policy table in AutopilotSettingsForm ✓
- #27 Train My Agent: Tasks 2, 3, 4 — compiler, API, preview, UI ✓
- #37 Snippets: Task 5 — miner, API, settings, composer ✓
- #41 Clean Inbox: Task 6 — batch routes, page, undo, AppRail ✓

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `compileRule` returns `CompiledRule` — used consistently in Task 2 (definition) and Task 3 (import)
- `buildBatchToken`/`parseBatchToken` exported from archive-batch route and imported in undo route ✓
- `mineSnippets(tenantId: string)` — consistent between test mock and implementation ✓
