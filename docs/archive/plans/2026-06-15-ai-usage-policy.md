# AI Usage Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce latency and token spend by skipping, deferring, and caching expensive AI work for low-value or unchanged email threads.

**Architecture:** Keep deterministic email/work-item classification synchronous, then use a small AI policy helper to decide whether richer relationship memory deserves an LLM call. Persist a content hash on `PersonMemory` so unchanged contact history is a cache hit, and record usage events for skipped/cache-hit/LLM paths.

**Tech Stack:** Next.js, TypeScript, Prisma/Postgres, Vitest, OpenAI Responses API.

---

### Task 1: Policy and Cache Tests

**Files:**
- Create: `tests/ai-usage-policy.test.ts`
- Modify: `tests/work-item-sync.test.ts`
- Modify: `tests/person-memory.test.ts`

- [x] Add failing tests for quiet/OTP/newsletter conversations skipping person-memory LLM.
- [x] Add failing tests for human/actionable conversations allowing person-memory LLM.
- [x] Add failing tests for person-memory content-hash cache hits.

### Task 2: AI Usage Policy

**Files:**
- Create: `lib/ai/usage-policy.ts`
- Modify: `lib/agent/work-item-sync.ts`

- [x] Implement tiered deterministic policy using email type, attention category, action type, outbound history, labels, support, and sales signals.
- [x] Use the policy before relationship-memory generation.
- [x] Preserve deterministic state/task/lead/email classification behavior.

### Task 3: Person Memory Cache and Metrics

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260615002000_person_memory_ai_cache/migration.sql`
- Modify: `lib/agent/person-memory.ts`

- [x] Add `source`, `contentHash`, `model`, and `llmSyncedAt` fields to `PersonMemory`.
- [x] Build a stable hash from cleaned recent contact history.
- [x] Return cache-hit/skipped/llm/fallback status from memory sync.
- [x] Record `AiUsageEvent` rows for skips, cache hits, completions, and failures.

### Task 4: Verification and PR

**Files:**
- All changed files.

- [x] Run focused Vitest suites.
- [x] Run lint/build if practical.
- [x] Commit, push branch, and open a draft PR.
