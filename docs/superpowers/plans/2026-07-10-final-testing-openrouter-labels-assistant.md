# Final Testing OpenRouter, Labels, Mail, And Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare FlowDesk Inbox for real-user testing by migrating AI calls to per-user OpenRouter child keys, unifying user-facing labels, keeping Mail tabs sticky across list/detail, and making Assistant pages usable with real rule/test/history/settings data.

**Architecture:** Add a small AI gateway around OpenRouter and make every AI call go through it. Use `FLOWDESK_GMAIL_LABEL_NAMES` as the single user-facing label vocabulary and map manual label changes into existing workflow, attention, content-type, Gmail writeback, audit, and correction paths. Reuse existing Assistant data models and APIs while reshaping the UI into productive tables/cards.

**Tech Stack:** Next.js 14 App Router, React Server Components, TypeScript, Prisma, PostgreSQL, Tailwind, Vitest, existing `openai` SDK with OpenRouter `baseURL`, existing NextAuth session auth.

## Global Constraints

- One OpenRouter runtime child key per FlowDesk user, not per tenant.
- No silent fallback to OpenAI in production.
- No fake Assistant sample data.
- No auto-send expansion.
- No auto-delete.
- No arbitrary custom labels in this phase.
- `FLOWDESK_GMAIL_LABEL_NAMES` is the source of truth for user-facing labels.
- Preserve legacy URL compatibility for `tab`, `status`, `attention`, and `type`, but new links emit `label`.
- Do not revert existing uncommitted docs/worktree changes that are unrelated to this plan.

---

## File Structure

- Create `lib/ai/openrouter-keys.ts`: provision/read/rotate per-user child keys.
- Create `lib/ai/openrouter.ts`: low-level OpenRouter runtime calls.
- Create `lib/ai/gateway.ts`: feature-aware gateway, budget preflight, usage recording.
- Modify `lib/ai/provider.ts`, `lib/ai/openai.ts`, `lib/agent/classify.ts`, `lib/agent/rule-compiler.ts`, `lib/agent/inbox-chat.ts`, `lib/agent/person-memory.ts`, `app/api/chat/route.ts`, `app/api/conversations/[id]/draft/suggest/route.ts`: route AI calls through the gateway.
- Modify `lib/ai/usage.ts`, `lib/ai/usage-summary.ts`, `lib/ai/budget.ts`, `app/settings/data/page.tsx`, `app/settings/AiUsagePanel.tsx`: support user/provider/actual-cost usage.
- Modify `prisma/schema.prisma`; create migration `prisma/migrations/20260710010000_openrouter_user_keys_and_usage/migration.sql`.
- Create `lib/mail-label-tabs.ts`; retire or wrap `lib/mail-top-tabs.ts`.
- Modify `app/components/MailTopTabs.tsx`, `app/components/AppListColumn.tsx`, `app/mail/page.tsx`, `app/conversations/[id]/page.tsx`.
- Create `lib/conversation-labels.ts`: maps canonical labels to state updates and query predicates.
- Create `app/api/conversations/[id]/flowdesk-label/route.ts`.
- Modify `app/components/useInboxRowActions.ts`, `app/components/MailInboxRow.tsx`, `app/conversations/[id]/WorkflowStatusSelect.tsx`, `app/conversations/[id]/LabelSelect.tsx`.
- Modify Assistant pages: `app/assistant/layout.tsx`, `app/assistant/rules/page.tsx`, `app/assistant/test-rules/page.tsx`, `app/assistant/history/page.tsx`, `app/assistant/settings/page.tsx`.
- Create Assistant helpers/components: `lib/assistant-rule-view.ts`, `app/assistant/TestRulesClient.tsx`, `app/assistant/RuleHistoryList.tsx`, `app/assistant/AssistantSettingsCards.tsx`.
- Update `.env.example` and `app/privacy/page.tsx` copy from OpenAI to OpenRouter/provider-neutral language.
- Add/modify tests listed in each task.

---

## Task 1: Schema And Environment Foundation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260710010000_openrouter_user_keys_and_usage/migration.sql`
- Modify: `.env.example`
- Modify: `app/privacy/page.tsx`
- Test: `tests/openrouter-schema-contract.test.ts`

**Interfaces:**
- Produces Prisma model `OpenRouterUserKey`.
- Extends `AiUsageEvent` with user/provider/generation/actual-cost fields.

- [ ] **Step 1: Write schema contract test**

Create `tests/openrouter-schema-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const schema = readFileSync("prisma/schema.prisma", "utf8")
const envExample = readFileSync(".env.example", "utf8")

describe("OpenRouter schema contract", () => {
  it("stores one OpenRouter child key per user", () => {
    expect(schema).toContain("model OpenRouterUserKey")
    expect(schema).toContain("userId               String   @unique")
    expect(schema).toContain("encryptedApiKey      String")
    expect(schema).toContain("keyHash              String   @unique")
  })

  it("records provider-aware AI usage", () => {
    expect(schema).toContain("userId")
    expect(schema).toContain("providerGenerationId")
    expect(schema).toContain("actualCostUsd")
    expect(schema).toContain("providerKeyHash")
  })

  it("documents OpenRouter env vars instead of OpenAI as the app default", () => {
    expect(envExample).toContain("OPENROUTER_API_KEY")
    expect(envExample).toContain("OPENROUTER_MANAGEMENT_API_KEY")
    expect(envExample).toContain("OPENROUTER_MODEL")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/openrouter-schema-contract.test.ts
```

Expected: fails because schema/env are not updated.

- [ ] **Step 3: Update Prisma schema**

Add relations:

```prisma
model Tenant {
  // existing fields...
  openRouterUserKeys       OpenRouterUserKey[]
}

model User {
  // existing fields...
  openRouterUserKey OpenRouterUserKey?
  aiUsageEvents     AiUsageEvent[]
}
```

Add model:

```prisma
model OpenRouterUserKey {
  id                String   @id @default(cuid())
  tenantId          String
  userId            String   @unique
  keyHash           String   @unique
  keyLabel          String
  encryptedApiKey   String
  limitUsd          Float?
  limitReset        String?
  disabled          Boolean  @default(false)
  lastProvisionedAt DateTime @default(now())
  lastUsedAt        DateTime?
  lastError         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  tenant            Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([disabled])
}
```

Extend `AiUsageEvent`:

```prisma
model AiUsageEvent {
  id                    String   @id @default(cuid())
  tenantId              String
  userId                String?
  feature               String
  provider              String   @default("openrouter")
  providerKeyHash       String?
  providerGenerationId  String?
  model                 String
  estimatedInputTokens  Int      @default(0)
  estimatedOutputTokens Int      @default(0)
  inputTokens           Int      @default(0)
  outputTokens          Int      @default(0)
  totalTokens           Int      @default(0)
  estimatedCostUsd      Float    @default(0)
  actualCostUsd         Float?
  status                String
  errorCode             String?
  errorMessage          String?
  createdAt             DateTime @default(now())
  tenant                Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user                  User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([userId, createdAt])
  @@index([feature])
  @@index([providerGenerationId])
}
```

- [ ] **Step 4: Add SQL migration**

Create `prisma/migrations/20260710010000_openrouter_user_keys_and_usage/migration.sql`:

```sql
CREATE TABLE "OpenRouterUserKey" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "keyLabel" TEXT NOT NULL,
  "encryptedApiKey" TEXT NOT NULL,
  "limitUsd" DOUBLE PRECISION,
  "limitReset" TEXT,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "lastProvisionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenRouterUserKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpenRouterUserKey_userId_key" ON "OpenRouterUserKey"("userId");
CREATE UNIQUE INDEX "OpenRouterUserKey_keyHash_key" ON "OpenRouterUserKey"("keyHash");
CREATE INDEX "OpenRouterUserKey_tenantId_idx" ON "OpenRouterUserKey"("tenantId");
CREATE INDEX "OpenRouterUserKey_disabled_idx" ON "OpenRouterUserKey"("disabled");

ALTER TABLE "OpenRouterUserKey"
  ADD CONSTRAINT "OpenRouterUserKey_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpenRouterUserKey"
  ADD CONSTRAINT "OpenRouterUserKey_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiUsageEvent" ADD COLUMN "userId" TEXT;
ALTER TABLE "AiUsageEvent" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'openrouter';
ALTER TABLE "AiUsageEvent" ADD COLUMN "providerKeyHash" TEXT;
ALTER TABLE "AiUsageEvent" ADD COLUMN "providerGenerationId" TEXT;
ALTER TABLE "AiUsageEvent" ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiUsageEvent" ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiUsageEvent" ADD COLUMN "totalTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiUsageEvent" ADD COLUMN "actualCostUsd" DOUBLE PRECISION;
ALTER TABLE "AiUsageEvent" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "AiUsageEvent" ADD COLUMN "errorMessage" TEXT;

CREATE INDEX "AiUsageEvent_userId_createdAt_idx" ON "AiUsageEvent"("userId", "createdAt");
CREATE INDEX "AiUsageEvent_providerGenerationId_idx" ON "AiUsageEvent"("providerGenerationId");

ALTER TABLE "AiUsageEvent"
  ADD CONSTRAINT "AiUsageEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Update env and privacy copy**

In `.env.example`, replace the OpenAI section with:

```text
# OpenRouter — used for AI classification, rules, chat, and draft suggestions.
OPENROUTER_API_KEY=""
OPENROUTER_MANAGEMENT_API_KEY=""
OPENROUTER_MODEL="anthropic/claude-sonnet-4.5"
OPENROUTER_LEARNING_MODEL="anthropic/claude-haiku-4.5"
OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD="10"
OPENROUTER_HTTP_REFERER="https://flowdeskinbox.com"
OPENROUTER_APP_TITLE="FlowDesk Inbox"
```

In `app/privacy/page.tsx`, replace provider-specific OpenAI copy with provider-neutral/OpenRouter copy that says AI processing is routed through OpenRouter and model providers.

- [ ] **Step 6: Run schema/env test**

Run:

```bash
npx vitest run tests/openrouter-schema-contract.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260710010000_openrouter_user_keys_and_usage/migration.sql .env.example app/privacy/page.tsx tests/openrouter-schema-contract.test.ts
git commit -m "feat(ai): add OpenRouter user key schema"
```

---

## Task 2: OpenRouter Key Provisioning And Runtime Gateway

**Files:**
- Create: `lib/ai/openrouter-keys.ts`
- Create: `lib/ai/openrouter.ts`
- Create: `lib/ai/gateway.ts`
- Modify: `lib/ai/usage.ts`
- Modify: `lib/ai/budget.ts`
- Test: `tests/openrouter-keys.test.ts`
- Test: `tests/openrouter-provider.test.ts`
- Test: `tests/ai-budget.test.ts`

**Interfaces:**
- Produces `getOpenRouterApiKeyForUser(input): Promise<OpenRouterRuntimeKey>`.
- Produces `callOpenRouterJson<T>(input): Promise<OpenRouterCallResult<T>>`.
- Produces `runAiJsonFeature<T>(input): Promise<T>`.

- [ ] **Step 1: Write key provisioning tests**

Create `tests/openrouter-keys.test.ts` with mocked `global.fetch`, `encryptString`, `decryptString`, and Prisma:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFindUnique = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    openRouterUserKey: {
      findUnique: mockFindUnique,
      create: mockCreate,
      update: mockUpdate,
    },
  },
}))

vi.mock("@/lib/crypto", () => ({
  encryptString: (value: string) => `enc:${value}`,
  decryptString: (value: string) => value.replace(/^enc:/, ""),
}))

describe("getOpenRouterApiKeyForUser", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.OPENROUTER_MANAGEMENT_API_KEY = "mgmt"
    process.env.OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD = "10"
  })

  it("returns an existing active child key", async () => {
    mockFindUnique.mockResolvedValue({
      encryptedApiKey: "enc:sk-or-user",
      keyHash: "hash1",
      disabled: false,
    })
    const { getOpenRouterApiKeyForUser } = await import("@/lib/ai/openrouter-keys")
    await expect(getOpenRouterApiKeyForUser({ tenantId: "t1", userId: "u1", email: "a@example.com" }))
      .resolves.toMatchObject({ apiKey: "sk-or-user", keyHash: "hash1" })
  })

  it("provisions and stores a child key when missing", async () => {
    mockFindUnique.mockResolvedValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "sk-or-new", hash: "hash2", label: "sk-or-v1-new" }),
    }))
    mockCreate.mockResolvedValue({ encryptedApiKey: "enc:sk-or-new", keyHash: "hash2", disabled: false })

    const { getOpenRouterApiKeyForUser } = await import("@/lib/ai/openrouter-keys")
    const key = await getOpenRouterApiKeyForUser({ tenantId: "t1", userId: "u1", email: "a@example.com" })

    expect(key).toMatchObject({ apiKey: "sk-or-new", keyHash: "hash2" })
    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/keys",
      expect.objectContaining({ method: "POST" })
    )
    expect(mockCreate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Write runtime gateway tests**

Create `tests/openrouter-provider.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("callOpenRouterJson", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.OPENROUTER_HTTP_REFERER = "https://flowdeskinbox.com"
    process.env.OPENROUTER_APP_TITLE = "FlowDesk Inbox"
  })

  it("sends app headers, user id, model, schema, and returns usage metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "gen-1",
        model: "anthropic/claude-sonnet-4.5",
        choices: [{ message: { content: "{\"ok\":true}" } }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 5,
          total_tokens: 17,
          cost: 0.0002,
        },
      }),
    }))

    const { callOpenRouterJson } = await import("@/lib/ai/openrouter")
    const result = await callOpenRouterJson<{ ok: boolean }>({
      apiKey: "sk-or-test",
      keyHash: "hash",
      userId: "u1",
      model: "anthropic/claude-sonnet-4.5",
      messages: [{ role: "user", content: "Return JSON" }],
      schemaName: "test_schema",
      schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
    })

    expect(result.output).toEqual({ ok: true })
    expect(result.providerGenerationId).toBe("gen-1")
    expect(result.actualCostUsd).toBe(0.0002)
    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-or-test",
          "HTTP-Referer": "https://flowdeskinbox.com",
          "X-OpenRouter-Title": "FlowDesk Inbox",
        }),
      })
    )
    const body = JSON.parse((fetch as unknown as vi.Mock).mock.calls[0][1].body)
    expect(body.user).toBe("u1")
    expect(body.response_format.type).toBe("json_schema")
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npx vitest run tests/openrouter-keys.test.ts tests/openrouter-provider.test.ts
```

Expected: fail because modules do not exist.

- [ ] **Step 4: Implement `openrouter-keys.ts`**

Implement:

```ts
import { prisma } from "@/lib/prisma"
import { encryptString, decryptString } from "@/lib/crypto"

export type OpenRouterRuntimeKey = {
  apiKey: string
  keyHash: string | null
}

export async function getOpenRouterApiKeyForUser(input: {
  tenantId: string
  userId: string
  email: string
}): Promise<OpenRouterRuntimeKey> {
  const existing = await prisma.openRouterUserKey.findUnique({ where: { userId: input.userId } })
  if (existing && !existing.disabled) {
    await prisma.openRouterUserKey.update({
      where: { userId: input.userId },
      data: { lastUsedAt: new Date(), lastError: null },
    }).catch(() => {})
    return { apiKey: decryptString(existing.encryptedApiKey), keyHash: existing.keyHash }
  }

  if (!process.env.OPENROUTER_MANAGEMENT_API_KEY) {
    if (process.env.NODE_ENV !== "production" && process.env.OPENROUTER_API_KEY) {
      return { apiKey: process.env.OPENROUTER_API_KEY, keyHash: null }
    }
    throw new Error("OPENROUTER_MANAGEMENT_API_KEY is not configured")
  }

  const limit = Number(process.env.OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD ?? "10")
  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_MANAGEMENT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `flowdesk:user:${input.userId}:${input.email}`,
      limit: Number.isFinite(limit) ? limit : 10,
      limit_reset: "monthly",
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof data?.error?.message === "string" ? data.error.message : "OpenRouter key provisioning failed")
  }

  const apiKey = typeof data.key === "string" ? data.key : typeof data.value === "string" ? data.value : null
  const keyHash = typeof data.hash === "string" ? data.hash : typeof data.data?.hash === "string" ? data.data.hash : null
  const keyLabel = typeof data.label === "string" ? data.label : typeof data.data?.label === "string" ? data.data.label : "openrouter-child-key"

  if (!apiKey || !keyHash) throw new Error("OpenRouter key provisioning response was missing key/hash")

  await prisma.openRouterUserKey.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      keyHash,
      keyLabel,
      encryptedApiKey: encryptString(apiKey),
      limitUsd: Number.isFinite(limit) ? limit : 10,
      limitReset: "monthly",
    },
  })

  return { apiKey, keyHash }
}
```

- [ ] **Step 5: Implement `openrouter.ts`**

Implement a fetch-based OpenRouter client:

```ts
export type OpenRouterMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type OpenRouterJsonCallInput = {
  apiKey: string
  keyHash: string | null
  userId: string
  model: string
  messages: OpenRouterMessage[]
  schemaName: string
  schema: Record<string, unknown>
  temperature?: number
  maxTokens?: number
}

export type OpenRouterCallResult<T> = {
  output: T
  model: string
  providerGenerationId: string | null
  providerKeyHash: string | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  actualCostUsd: number | null
}

export async function callOpenRouterJson<T>(input: OpenRouterJsonCallInput): Promise<OpenRouterCallResult<T>> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "https://flowdeskinbox.com",
      "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE ?? "FlowDesk Inbox",
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      user: input.userId,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : `OpenRouter request failed (${res.status})`
    const err = new Error(message) as Error & { code?: string }
    err.code = String(data?.error?.code ?? res.status)
    throw err
  }

  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenRouter response did not include content")

  let output: T
  try {
    output = JSON.parse(content) as T
  } catch {
    throw new Error("OpenRouter response was not valid JSON")
  }

  return {
    output,
    model: typeof data.model === "string" ? data.model : input.model,
    providerGenerationId: typeof data.id === "string" ? data.id : null,
    providerKeyHash: input.keyHash,
    inputTokens: Number(data.usage?.prompt_tokens ?? 0),
    outputTokens: Number(data.usage?.completion_tokens ?? 0),
    totalTokens: Number(data.usage?.total_tokens ?? 0),
    actualCostUsd: typeof data.usage?.cost === "number" ? data.usage.cost : null,
  }
}
```

- [ ] **Step 6: Extend usage recording**

Update `recordAiUsageEvent` in `lib/ai/usage.ts` to accept the new fields and use `actualCostUsd ?? estimatedCostUsd`.

- [ ] **Step 7: Implement gateway**

Create `lib/ai/gateway.ts` with:

```ts
export async function runAiJsonFeature<T>(input: {
  tenantId: string
  userId: string
  userEmail: string
  feature: string
  model?: string
  messages: OpenRouterMessage[]
  schemaName: string
  schema: Record<string, unknown>
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
}): Promise<{ output: T; model: string; providerGenerationId: string | null }> {
  // check budget, provision key, call OpenRouter, record success/failure usage
}
```

Use `checkAiBudgetForTokens` before provisioning. On success, record provider metadata. On blocked/failed, record a blocked/failed `AiUsageEvent`.

- [ ] **Step 8: Run focused tests**

Run:

```bash
npx vitest run tests/openrouter-keys.test.ts tests/openrouter-provider.test.ts tests/ai-budget.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add lib/ai/openrouter-keys.ts lib/ai/openrouter.ts lib/ai/gateway.ts lib/ai/usage.ts lib/ai/budget.ts tests/openrouter-keys.test.ts tests/openrouter-provider.test.ts tests/ai-budget.test.ts
git commit -m "feat(ai): add OpenRouter gateway"
```

---

## Task 3: Migrate AI Call Sites To Gateway

**Files:**
- Modify: `lib/ai/provider.ts`
- Modify: `lib/ai/openai.ts`
- Modify: `lib/agent/classify.ts`
- Modify: `lib/agent/rule-compiler.ts`
- Modify: `lib/agent/inbox-chat.ts`
- Modify: `lib/agent/person-memory.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/conversations/[id]/draft/suggest/route.ts`
- Modify tests that mock `openai`: `tests/ai-draft-provider.test.ts`, `tests/rule-compiler.test.ts`, `tests/static-first-classify.test.ts`, `tests/person-memory.test.ts`, `tests/ai-draft-routes.test.ts`

**Interfaces:**
- Consumes `runAiJsonFeature`.
- Produces no direct `OPENAI_API_KEY` runtime dependency for app AI paths.

- [ ] **Step 1: Write migration contract test**

Add to `tests/openrouter-provider.test.ts`:

```ts
import { readFileSync } from "node:fs"

it("keeps app AI paths off direct OPENAI_API_KEY checks", () => {
  for (const path of [
    "lib/agent/classify.ts",
    "lib/agent/rule-compiler.ts",
    "lib/agent/inbox-chat.ts",
    "lib/agent/person-memory.ts",
    "app/api/chat/route.ts",
    "app/api/conversations/[id]/draft/suggest/route.ts",
  ]) {
    const source = readFileSync(path, "utf8")
    expect(source).not.toContain("OPENAI_API_KEY")
  }
})
```

- [ ] **Step 2: Run current AI tests to establish failures after contract**

Run:

```bash
npx vitest run tests/openrouter-provider.test.ts tests/ai-draft-provider.test.ts tests/rule-compiler.test.ts tests/static-first-classify.test.ts tests/person-memory.test.ts tests/ai-draft-routes.test.ts
```

Expected: contract fails before migration.

- [ ] **Step 3: Migrate prompt transports**

For each feature:

- Keep existing prompt builder.
- Keep existing normalizer.
- Replace direct OpenAI SDK call with `runAiJsonFeature`.
- Pass a concrete feature key:
  - `autopilot.draft`
  - `conversation.explain`
  - `personal_profile.train`
  - `reply_learning.summarize`
  - `meeting.prep`
  - `meeting.follow_up`
  - `lead.score`
  - `agent.classify`
  - `agent_rule.compile`
  - `chat.inbox`
  - `person_memory.llm`

For app routes, pass `session.user.id`, `session.user.email`, and `session.user.tenantId`.

For background jobs where no user is in session, use the tenant's first user:

```ts
const owner = await prisma.user.findFirst({
  where: { tenantId },
  orderBy: { createdAt: "asc" },
  select: { id: true, email: true },
})
```

If no user exists, fail clearly before AI call.

- [ ] **Step 4: Preserve compatibility exports**

Rename implementation exports only if necessary. It is acceptable for `generateDraftReplyWithOpenAI` to remain as a compatibility function name temporarily if it internally uses the gateway. Add a deprecation comment:

```ts
// Compatibility name retained for existing tests/callers; transport is OpenRouter.
```

- [ ] **Step 5: Update tests**

Replace `vi.mock("openai")` expectations with gateway mocks where possible:

```ts
vi.mock("@/lib/ai/gateway", () => ({
  runAiJsonFeature: mockRunAiJsonFeature,
}))
```

Update missing-key error expectations from `OPENAI_API_KEY is not configured` to `OPENROUTER_MANAGEMENT_API_KEY is not configured` or provider-neutral `AI provider is not configured`, depending on the implemented error.

- [ ] **Step 6: Run focused AI tests**

Run:

```bash
npx vitest run tests/openrouter-provider.test.ts tests/ai-draft-provider.test.ts tests/rule-compiler.test.ts tests/static-first-classify.test.ts tests/person-memory.test.ts tests/ai-draft-routes.test.ts tests/lead-scoring.test.ts tests/reply-learning.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/provider.ts lib/ai/openai.ts lib/agent/classify.ts lib/agent/rule-compiler.ts lib/agent/inbox-chat.ts lib/agent/person-memory.ts app/api/chat/route.ts app/api/conversations/[id]/draft/suggest/route.ts tests/openrouter-provider.test.ts tests/ai-draft-provider.test.ts tests/rule-compiler.test.ts tests/static-first-classify.test.ts tests/person-memory.test.ts tests/ai-draft-routes.test.ts tests/lead-scoring.test.ts tests/reply-learning.test.ts
git commit -m "refactor(ai): route AI calls through OpenRouter"
```

---

## Task 4: Canonical Mail Label Tabs

**Files:**
- Create: `lib/mail-label-tabs.ts`
- Modify: `lib/mail-top-tabs.ts`
- Modify: `app/components/MailTopTabs.tsx`
- Modify: `app/components/AppListColumn.tsx`
- Modify: `app/mail/page.tsx`
- Test: `tests/mail-label-tabs.test.ts`
- Modify: `tests/mail-top-tabs.test.ts`
- Modify: `tests/dashboard-ui-contracts.test.ts`

**Interfaces:**
- Produces `MAIL_LABEL_TABS`, `MailLabelTabValue`, `matchesMailLabelTab`, `buildMailLabelTabWhere`, `coerceMailLabelTab`.

- [ ] **Step 1: Write label-tab tests**

Create `tests/mail-label-tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { FLOWDESK_GMAIL_LABEL_NAMES } from "@/lib/gmail-labels"
import {
  MAIL_LABEL_TABS,
  buildMailLabelTabWhere,
  coerceMailLabelTab,
  matchesMailLabelTab,
} from "@/lib/mail-label-tabs"

describe("MAIL_LABEL_TABS", () => {
  it("matches canonical Gmail labels plus All", () => {
    expect(MAIL_LABEL_TABS.map((t) => t.label)).toEqual(["All", ...FLOWDESK_GMAIL_LABEL_NAMES])
  })

  it("does not expose legacy synthetic tabs", () => {
    expect(MAIL_LABEL_TABS.map((t) => t.label)).not.toContain("Important")
    expect(MAIL_LABEL_TABS.map((t) => t.label)).not.toContain("Other")
  })
})

describe("coerceMailLabelTab", () => {
  it("accepts new label params and legacy tab params", () => {
    expect(coerceMailLabelTab({ label: "newsletter" })).toBe("newsletter")
    expect(coerceMailLabelTab({ tab: "calendar" })).toBe("calendar")
    expect(coerceMailLabelTab({ tab: "other" })).toBe("handled")
    expect(coerceMailLabelTab({ tab: "important" })).toBe("all")
  })
})

describe("matchesMailLabelTab", () => {
  it("maps workflow and content state to labels", () => {
    expect(matchesMailLabelTab("needs_reply", { workflowStatus: "needs_reply", draftStatus: null, attentionCategory: null, emailType: null })).toBe(true)
    expect(matchesMailLabelTab("autodrafted", { workflowStatus: "draft_ready", draftStatus: "proposed", attentionCategory: null, emailType: null })).toBe(true)
    expect(matchesMailLabelTab("needs_action", { workflowStatus: "needs_reply", draftStatus: null, attentionCategory: "needs_action", emailType: null })).toBe(true)
    expect(matchesMailLabelTab("marketing", { workflowStatus: "done", draftStatus: null, attentionCategory: null, emailType: "marketing" })).toBe(true)
  })
})

describe("buildMailLabelTabWhere", () => {
  it("builds query filters for content labels", () => {
    expect(buildMailLabelTabWhere("notification")).toEqual({
      stateRecord: { is: { emailType: { in: ["notification", "fyi"] } } },
    })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run tests/mail-label-tabs.test.ts
```

Expected: fail because module does not exist.

- [ ] **Step 3: Implement `lib/mail-label-tabs.ts`**

Implement canonical labels and predicates:

```ts
import { FLOWDESK_GMAIL_LABEL_NAMES } from "@/lib/gmail-labels"
import type { WorkflowStatus } from "@/lib/workflow-status"

export type MailLabelTabValue =
  | "all"
  | "needs_reply"
  | "needs_action"
  | "waiting_on"
  | "read_later"
  | "handled"
  | "autodrafted"
  | "newsletter"
  | "marketing"
  | "notification"
  | "calendar"

export const MAIL_LABEL_TABS = [
  { value: "all", label: "All" },
  ...FLOWDESK_GMAIL_LABEL_NAMES.map((label) => ({ value: labelToValue(label), label })),
] as { value: MailLabelTabValue; label: string }[]

export function labelToValue(label: string): MailLabelTabValue {
  return label.toLowerCase().replace(/\s+/g, "_") as MailLabelTabValue
}

export function coerceMailLabelTab(input: { label?: string; tab?: string }): MailLabelTabValue {
  const raw = input.label ?? input.tab ?? "all"
  if (raw === "other") return "handled"
  if (raw === "important") return "all"
  return MAIL_LABEL_TABS.some((t) => t.value === raw) ? raw as MailLabelTabValue : "all"
}

export function matchesMailLabelTab(tab: MailLabelTabValue, input: {
  workflowStatus: WorkflowStatus
  draftStatus?: string | null
  attentionCategory?: string | null
  emailType?: string | null
}): boolean {
  switch (tab) {
    case "all": return true
    case "needs_reply": return input.workflowStatus === "needs_reply" || input.workflowStatus === "draft_ready"
    case "needs_action": return input.attentionCategory === "needs_action"
    case "waiting_on": return input.workflowStatus === "waiting_on"
    case "read_later": return input.workflowStatus === "read_later"
    case "handled": return input.workflowStatus === "done"
    case "autodrafted": return input.workflowStatus === "draft_ready" || input.draftStatus === "proposed" || input.draftStatus === "approved"
    case "newsletter": return input.emailType === "newsletter"
    case "marketing": return input.emailType === "marketing"
    case "notification": return input.emailType === "notification" || input.emailType === "fyi"
    case "calendar": return input.emailType === "calendar"
  }
}

export function buildMailLabelTabWhere(tab: MailLabelTabValue | null | undefined): Record<string, unknown> | null {
  switch (tab) {
    case "needs_reply": return { OR: [{ status: "needs_reply" }, { draft: { is: { status: "proposed" } } }] }
    case "needs_action": return { stateRecord: { is: { attentionCategory: "needs_action" } } }
    case "waiting_on": return { OR: [{ userState: "waiting_on" }, { status: "in_progress" }, { stateRecord: { is: { attentionCategory: "waiting_on" } } }] }
    case "read_later": return { OR: [{ userState: "read_later" }, { stateRecord: { is: { attentionCategory: "read_later" } } }] }
    case "handled": return { OR: [{ userState: "done" }, { status: "closed" }, { stateRecord: { is: { attentionCategory: { in: ["quiet", "fyi_done"] } } } }] }
    case "autodrafted": return { draft: { is: { status: { in: ["proposed", "approved"] } } } }
    case "newsletter": return { stateRecord: { is: { emailType: "newsletter" } } }
    case "marketing": return { stateRecord: { is: { emailType: "marketing" } } }
    case "notification": return { stateRecord: { is: { emailType: { in: ["notification", "fyi"] } } } }
    case "calendar": return { stateRecord: { is: { emailType: "calendar" } } }
    default: return null
  }
}
```

- [ ] **Step 4: Update compatibility wrapper**

Change `lib/mail-top-tabs.ts` to re-export from `lib/mail-label-tabs.ts` or leave a small compatibility wrapper. New code should import `mail-label-tabs`.

- [ ] **Step 5: Update Mail components**

Update:

- `MailTopTabs` props from `activeTab` to `activeLabel`.
- Link query param from `tab` to `label`.
- `AppListColumn.getCachedListData` input from `topTab` to `labelTab`.
- `/mail` to call `coerceMailLabelTab(searchParams)` and pass `labelTab`.
- Counts should include all labels from fetched window first. Account-wide counts can be added later.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run tests/mail-label-tabs.test.ts tests/mail-top-tabs.test.ts tests/dashboard-ui-contracts.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add lib/mail-label-tabs.ts lib/mail-top-tabs.ts app/components/MailTopTabs.tsx app/components/AppListColumn.tsx app/mail/page.tsx tests/mail-label-tabs.test.ts tests/mail-top-tabs.test.ts tests/dashboard-ui-contracts.test.ts
git commit -m "feat(mail): align tabs with FlowDesk labels"
```

---

## Task 5: Sticky Mail Tabs On Thread Detail

**Files:**
- Modify: `app/conversations/[id]/page.tsx`
- Modify: `app/components/AppListColumn.tsx`
- Modify: `lib/client-navigation.ts`
- Test: `tests/client-navigation.test.ts`
- Test: `tests/dashboard-ui-contracts.test.ts`

**Interfaces:**
- Detail page preserves and renders active Mail label context from `returnTo`.
- Left list in split detail respects the active label filter.

- [ ] **Step 1: Add UI contract test**

In `tests/dashboard-ui-contracts.test.ts`, add:

```ts
it("conversation detail keeps Mail top tabs in the desktop shell", () => {
  const page = source("app/conversations/[id]/page.tsx")
  expect(page).toContain("MailTopTabs")
  expect(page).toContain("activeLabel")
  expect(page).toContain("returnLabel")
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/dashboard-ui-contracts.test.ts
```

Expected: fail because detail page does not import/render `MailTopTabs`.

- [ ] **Step 3: Parse label from return path**

In `app/conversations/[id]/page.tsx`, after `inboxReturnParams`:

```ts
const returnLabel = coerceMailLabelTab({
  label: inboxReturnParams.get("label") ?? undefined,
  tab: inboxReturnParams.get("tab") ?? undefined,
})
```

Pass `labelTab={returnLabel}` to `AppListColumn`.

- [ ] **Step 4: Render sticky tabs above desktop split**

Import `MailTopTabs` and compute lightweight counts from the left-list fetched window if available. If count wiring is too invasive, pass zero counts initially and let active tab context be the primary UX fix.

Wrap the desktop content:

```tsx
<div className="hidden lg:flex h-screen overflow-hidden bg-slate-50">
  <AppRail ... />
  <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
    <div className="shrink-0 border-b border-slate-200 bg-white">
      <MailTopTabs activeLabel={returnLabel} counts={mailLabelCounts} preserveQuery={{ q: returnQuery }} />
    </div>
    <DesktopResizablePanels ... />
  </div>
</div>
```

Ensure `DesktopResizablePanels` still fills remaining height.

- [ ] **Step 5: Update return links**

Ensure row hrefs and `buildConversationHref` preserve `label` in `returnTo`.

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/client-navigation.test.ts tests/dashboard-ui-contracts.test.ts tests/mail-label-tabs.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add app/conversations/[id]/page.tsx app/components/AppListColumn.tsx lib/client-navigation.ts tests/client-navigation.test.ts tests/dashboard-ui-contracts.test.ts
git commit -m "fix(mail): keep label tabs on thread detail"
```

---

## Task 6: Unified Label Correction Endpoint And Controls

**Files:**
- Create: `lib/conversation-labels.ts`
- Create: `app/api/conversations/[id]/flowdesk-label/route.ts`
- Modify: `app/components/useInboxRowActions.ts`
- Modify: `app/components/MailInboxRow.tsx`
- Modify: `app/conversations/[id]/WorkflowStatusSelect.tsx`
- Modify: `app/conversations/[id]/LabelSelect.tsx`
- Modify: `app/conversations/[id]/page.tsx`
- Test: `tests/conversation-label-route.test.ts`
- Modify: `tests/attention-correction.test.ts`
- Modify: `tests/dashboard-ui-contracts.test.ts`

**Interfaces:**
- Produces `setConversationFlowDeskLabel(input)`.
- Produces `PATCH /api/conversations/:id/flowdesk-label` with body `{ label: FlowDeskGmailLabelName }`.

- [ ] **Step 1: Write label route tests**

Create `tests/conversation-label-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSession = { user: { id: "u1", tenantId: "t1", email: "u@example.com" } }
const mockFindFirst = vi.fn()
const mockUpdate = vi.fn()
const mockUpsert = vi.fn()
const mockAuditCreate = vi.fn()
const mockCorrectionCreate = vi.fn()
const mockQueue = vi.fn()

vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockFindFirst, update: mockUpdate },
    conversationState: { findUnique: vi.fn(), upsert: mockUpsert },
    auditLog: { create: mockAuditCreate },
    classificationCorrection: { create: mockCorrectionCreate },
  },
}))
vi.mock("@/lib/gmail-labels", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gmail-labels")>("@/lib/gmail-labels")
  return { ...actual, queueFlowDeskLabelWriteback: mockQueue }
})

describe("PATCH /flowdesk-label", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirst.mockResolvedValue({
      id: "c1",
      tenantId: "t1",
      channelId: "ch1",
      externalThreadId: "thread1",
      status: "needs_reply",
      userState: null,
      contact: { phoneE164: "sender@example.com" },
      draft: null,
      stateRecord: null,
      channel: { provider: "google" },
    })
  })

  it("sets Newsletter as a content label and records learning", async () => {
    const { PATCH } = await import("@/app/api/conversations/[id]/flowdesk-label/route")
    const res = await PATCH(new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ label: "Newsletter" }),
    }), { params: { id: "c1" } })

    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        emailType: "newsletter",
      }),
    }))
    expect(mockAuditCreate).toHaveBeenCalled()
    expect(mockCorrectionCreate).toHaveBeenCalled()
    expect(mockQueue).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Add UI copy contract**

In `tests/dashboard-ui-contracts.test.ts`, assert:

```ts
it("mail row uses label language rather than tag language", () => {
  const row = source("app/components/MailInboxRow.tsx")
  expect(row).toContain("Change label")
  expect(row).not.toContain("Change tag")
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npx vitest run tests/conversation-label-route.test.ts tests/dashboard-ui-contracts.test.ts
```

Expected: fail.

- [ ] **Step 4: Implement `lib/conversation-labels.ts`**

Implement:

```ts
import { prisma } from "@/lib/prisma"
import { conversationStateMetadataData } from "@/lib/agent/conversation-state-metadata"
import { flowDeskLabelsForConversationState, queueFlowDeskLabelWriteback, type FlowDeskGmailLabelName } from "@/lib/gmail-labels"
import { revalidateInboxViews } from "@/lib/cache-tags"

export function labelToState(label: FlowDeskGmailLabelName) {
  // return status, userState, state, priority, reason, nextAction, attentionCategory, emailType
}

export async function setConversationFlowDeskLabel(input: {
  tenantId: string
  userId: string
  conversationId: string
  label: FlowDeskGmailLabelName
}) {
  // fetch conversation, apply state, upsert ConversationState, create AuditLog,
  // create ClassificationCorrection, queue Gmail labels, revalidate.
}
```

Mappings:

- `Needs Reply`: `status=needs_reply`, `userState=needs_reply`, `attentionCategory=needs_reply`, no `emailType`.
- `Needs Action`: `status=needs_reply`, `userState=needs_action`, `attentionCategory=needs_action`.
- `Waiting On`: `status=in_progress`, `userState=waiting_on`, `attentionCategory=waiting_on`.
- `Read Later`: `status=needs_reply`, `userState=read_later`, `attentionCategory=read_later`.
- `Handled`: `status=closed`, `userState=done`, `attentionCategory=fyi_done`.
- `Newsletter`: `status=closed`, `userState=quiet`, `attentionCategory=quiet`, `emailType=newsletter`.
- `Marketing`: `status=closed`, `userState=quiet`, `attentionCategory=quiet`, `emailType=marketing`.
- `Notification`: `status=closed`, `userState=fyi_done`, `attentionCategory=fyi_done`, `emailType=notification`.
- `Calendar`: preserve `status` if actionable, set `emailType=calendar`, `attentionCategory=needs_action` only when no existing attention category.
- `Autodrafted`: reject manual selection unless existing draft status is `proposed` or `approved`; do not create drafts.

- [ ] **Step 5: Implement route**

Create `app/api/conversations/[id]/flowdesk-label/route.ts`:

```ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isFlowDeskGmailLabelName } from "@/lib/gmail-labels"
import { setConversationFlowDeskLabel } from "@/lib/conversation-labels"

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId || !session.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!isFlowDeskGmailLabelName(body.label)) return NextResponse.json({ error: "Invalid label" }, { status: 400 })
  await setConversationFlowDeskLabel({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    conversationId: params.id,
    label: body.label,
  })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: Update row actions**

In `useInboxRowActions`, replace `WORKFLOW_OPTIONS` with `FLOWDESK_LABEL_OPTIONS`. Use `/flowdesk-label` for label changes. Keep `toggleStatus` for explicit done/reopen buttons.

In `MailInboxRow`, update:

- `title="Change label"`
- `aria-label="Change label"`
- dropdown includes all canonical labels except disabled `Autodrafted` when no draft.

- [ ] **Step 7: Update thread sidebar**

Replace the business-only `LabelSelect` in `contactCard` with a FlowDesk label selector visible for personal and business accounts. Move or remove the old business `Conversation.label` control. If Sales metadata still needs editing, leave it inside `SalesPanel`, not the generic contact card.

- [ ] **Step 8: Run focused tests**

Run:

```bash
npx vitest run tests/conversation-label-route.test.ts tests/attention-correction.test.ts tests/dashboard-ui-contracts.test.ts tests/gmail-writeback-labels.test.ts tests/preference-learning.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add lib/conversation-labels.ts app/api/conversations/[id]/flowdesk-label/route.ts app/components/useInboxRowActions.ts app/components/MailInboxRow.tsx app/conversations/[id]/WorkflowStatusSelect.tsx app/conversations/[id]/LabelSelect.tsx app/conversations/[id]/page.tsx tests/conversation-label-route.test.ts tests/attention-correction.test.ts tests/dashboard-ui-contracts.test.ts
git commit -m "feat(mail): unify tags and labels"
```

---

## Task 7: Assistant Rules, Test, History, And Settings UX

**Files:**
- Modify: `app/assistant/layout.tsx`
- Modify: `app/assistant/rules/page.tsx`
- Modify: `app/assistant/test-rules/page.tsx`
- Modify: `app/assistant/history/page.tsx`
- Modify: `app/assistant/settings/page.tsx`
- Create: `app/assistant/TestRulesClient.tsx`
- Create: `app/assistant/RuleHistoryList.tsx`
- Create: `app/assistant/AssistantSettingsCards.tsx`
- Create: `lib/assistant-rule-view.ts`
- Test: `tests/assistant-ui-contracts.test.ts`
- Modify: `tests/assistant-tabs.test.ts`
- Modify: `tests/agent-rule-dry-run.test.ts`

**Interfaces:**
- Produces readable Assistant rule/action/history view models.
- Keeps existing `/api/agent-rules/dry-run` API.

- [ ] **Step 1: Write Assistant UI contract tests**

Create `tests/assistant-ui-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

function source(path: string) {
  return readFileSync(path, "utf8")
}

describe("Assistant UI contracts", () => {
  it("does not use AppSidebar in Assistant layout", () => {
    expect(source("app/assistant/layout.tsx")).not.toContain("AppSidebar")
  })

  it("Test Rules uses a rule select instead of raw Rule ID input", () => {
    const page = source("app/assistant/test-rules/page.tsx")
    expect(page).toContain("TestRulesClient")
    expect(page).not.toContain('placeholder="Rule ID"')
  })

  it("Rules page renders action chips and real rule summaries", () => {
    const page = source("app/assistant/rules/page.tsx")
    expect(page).toContain("Active rules")
    expect(page).toContain("Label as")
  })

  it("History page uses readable rule history presenter", () => {
    expect(source("app/assistant/history/page.tsx")).toContain("RuleHistoryList")
    expect(source("lib/assistant-rule-view.ts")).toContain("describeRuleAuditAction")
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run tests/assistant-ui-contracts.test.ts tests/assistant-tabs.test.ts
```

Expected: fail.

- [ ] **Step 3: Remove AppSidebar from Assistant layout**

In `app/assistant/layout.tsx`:

- Remove `AppSidebar` import and JSX.
- Keep `AppRail`.
- Make content scroll in `flex-1`.
- Change main layout to a single content column with horizontal `AssistantTabNav`.

- [ ] **Step 4: Implement rule view helpers**

Create `lib/assistant-rule-view.ts`:

```ts
export function actionChipsForRule(actionJson: Record<string, unknown>): string[] {
  const target = typeof actionJson.targetAttention === "string" ? actionJson.targetAttention : null
  const labels = Array.isArray(actionJson.gmailLabels) ? actionJson.gmailLabels : []
  const chips = labels.map((label) => `Label as '${label}'`)
  if (target && chips.length === 0) chips.push(`Label as '${target}'`)
  if (actionJson.createDraft === true) chips.push("Draft Reply")
  if (actionJson.archive === true) chips.push("Archive")
  return chips
}

export function describeRuleAuditAction(action: string): string {
  switch (action) {
    case "agent_rule.create": return "Rule created"
    case "agent_rule.update": return "Rule updated"
    case "agent_rule.version_snapshot": return "Version saved"
    case "agent_rule.delete": return "Rule deleted"
    case "agent_rule.dry_run": return "Rule tested"
    default: return action
  }
}
```

- [ ] **Step 5: Rebuild Rules page**

In `app/assistant/rules/page.tsx`:

- Load `SenderRule` and `AgentRule`.
- Compute counts: active, draft, learned, lastDryRunAt.
- Render a top stats row.
- Render a table with Enabled, Name, Prompt, Action, Last tested, menu.
- Use real data. If empty, render an empty state with a link/button to Settings/TrainAgentPanel.

- [ ] **Step 6: Rebuild Test Rules page**

Change `app/assistant/test-rules/page.tsx` to a server component that loads rules:

```ts
const rules = await prisma.agentRule.findMany({
  where: { tenantId, status: { in: ["active", "draft"] } },
  orderBy: { updatedAt: "desc" },
})
return <TestRulesClient rules={rules.map(...)} />
```

Create `TestRulesClient.tsx`:

- Select menu for rule.
- `Test` button.
- Result summary: sample size, matched/skipped, planned labels, automation level, whether Gmail labels would apply.
- Matched conversation list with evidence.
- No raw rule ID field.

- [ ] **Step 7: Rebuild History page**

Create `RuleHistoryList.tsx` and update `history/page.tsx`:

- Load `AuditLog` rule actions.
- Map through `describeRuleAuditAction`.
- Group by date label.
- Show timestamp, readable action, rule ID/version when present, and payload summary.

- [ ] **Step 8: Rebuild Settings page**

Create `AssistantSettingsCards.tsx`:

- Auto draft replies card.
- Draft confidence card.
- Follow-up reminders card.
- Digest card.
- Writing style card.
- Personal instructions card containing/near `TrainAgentPanel`.

Cards should use existing settings where available (`AutopilotSetting`, `FollowUpSetting`, `PersonalProfile`, latest `AiUsageEvent`). If a control is not implemented, render it disabled with accurate copy or omit it.

- [ ] **Step 9: Run focused tests**

Run:

```bash
npx vitest run tests/assistant-ui-contracts.test.ts tests/assistant-tabs.test.ts tests/agent-rule-dry-run.test.ts tests/static-rules-ui.test.ts
```

Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add app/assistant/layout.tsx app/assistant/rules/page.tsx app/assistant/test-rules/page.tsx app/assistant/history/page.tsx app/assistant/settings/page.tsx app/assistant/TestRulesClient.tsx app/assistant/RuleHistoryList.tsx app/assistant/AssistantSettingsCards.tsx lib/assistant-rule-view.ts tests/assistant-ui-contracts.test.ts tests/assistant-tabs.test.ts tests/agent-rule-dry-run.test.ts tests/static-rules-ui.test.ts
git commit -m "feat(assistant): polish rules test history and settings"
```

---

## Task 8: Usage Settings And Final Verification

**Files:**
- Modify: `lib/ai/usage-summary.ts`
- Modify: `app/settings/AiUsagePanel.tsx`
- Modify: `app/settings/data/page.tsx`
- Modify: `tests/ai-usage-summary.test.ts`
- Modify: `README.md`
- Modify: `docs/CURRENT_STATE.md`

**Interfaces:**
- Settings usage summary displays `actualCostUsd ?? estimatedCostUsd`.
- Optional user-level breakdown is available for admins/testing.

- [ ] **Step 1: Update usage summary tests**

In `tests/ai-usage-summary.test.ts`, add:

```ts
it("prefers actual provider cost over estimated cost", () => {
  const summary = summarizeAiUsage(
    [event({ estimatedCostUsd: 0.5, actualCostUsd: 0.02 } as Partial<AiUsageEventRow>)],
    { dailyLimitUsd: 5, monthlyLimitUsd: 50 },
    now
  )
  expect(summary.dailyUsedUsd).toBeCloseTo(0.02)
  expect(summary.monthlyUsedUsd).toBeCloseTo(0.02)
})
```

Update `AiUsageEventRow` type to include `actualCostUsd?: number | null`, `userId?: string | null`, `provider?: string | null`.

- [ ] **Step 2: Run usage test to verify failure**

Run:

```bash
npx vitest run tests/ai-usage-summary.test.ts
```

Expected: fail until summary uses actual cost.

- [ ] **Step 3: Update usage summary and panel**

In `lib/ai/usage-summary.ts`, use:

```ts
const cost = event.actualCostUsd ?? event.estimatedCostUsd
```

In `app/settings/data/page.tsx`, select the new fields from `aiUsageEvent`.

In `AiUsagePanel`, optionally show provider/model/generation metadata in compact rows if existing UI supports it cleanly.

- [ ] **Step 4: Update docs**

In `README.md` and `docs/CURRENT_STATE.md`, update AI provider configuration:

- OpenRouter is the default AI provider.
- Per-user child keys are provisioned with a management key.
- `OPENAI_API_KEY` is no longer required for app AI.

- [ ] **Step 5: Run full focused suite**

Run:

```bash
npx vitest run tests/openrouter-schema-contract.test.ts tests/openrouter-keys.test.ts tests/openrouter-provider.test.ts tests/ai-usage-summary.test.ts tests/mail-label-tabs.test.ts tests/conversation-label-route.test.ts tests/dashboard-ui-contracts.test.ts tests/assistant-ui-contracts.test.ts tests/assistant-tabs.test.ts tests/agent-rule-dry-run.test.ts tests/gmail-writeback-labels.test.ts tests/preference-learning.test.ts
```

Expected: pass.

- [ ] **Step 6: Run build**

Run:

```bash
npm run build
```

Expected: build completes.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/usage-summary.ts app/settings/AiUsagePanel.tsx app/settings/data/page.tsx tests/ai-usage-summary.test.ts README.md docs/CURRENT_STATE.md
git commit -m "chore(ai): surface OpenRouter usage accounting"
```

---

## Final Verification Checklist

- [ ] `npx vitest run tests/openrouter-schema-contract.test.ts tests/openrouter-keys.test.ts tests/openrouter-provider.test.ts`
- [ ] `npx vitest run tests/mail-label-tabs.test.ts tests/conversation-label-route.test.ts`
- [ ] `npx vitest run tests/dashboard-ui-contracts.test.ts tests/assistant-ui-contracts.test.ts tests/assistant-tabs.test.ts`
- [ ] `npx vitest run tests/agent-rule-dry-run.test.ts tests/gmail-writeback-labels.test.ts tests/preference-learning.test.ts`
- [ ] `npm run build`
- [ ] Manual browser check:
  - `/mail` shows canonical label tabs.
  - Opening an email keeps the Mail top tabs visible.
  - Row hover says "Change label" and includes Newsletter/Marketing/Notification/Calendar.
  - Thread sidebar label control shows canonical labels.
  - Assistant Rules/Test/History/Settings are populated from real data or show useful empty states.
  - First AI call for a user provisions or uses an OpenRouter child key and records user-level usage.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-final-testing-openrouter-labels-assistant.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.

Recommended: Subagent-Driven, because the OpenRouter migration, label state model, Mail layout, and Assistant UI can be reviewed as separate slices.
