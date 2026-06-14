# Intent Auto-Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional rough-instruction field to AI draft generation so users can turn messy intent into a polished proposed reply.

**Architecture:** Extend the existing draft prompt input, draft suggest route, and AI draft panel. Reuse the current `Draft` model, metadata, audit log, and approval/send flow; no schema changes.

**Tech Stack:** Next.js App Router, React client component, TypeScript, Prisma, Vitest.

---

### Task 1: Prompt And Route Behavior

**Files:**
- Modify: `lib/ai/prompts/draft-reply.ts`
- Modify: `app/api/conversations/[id]/draft/suggest/route.ts`
- Modify: `tests/ai-draft-provider.test.ts`
- Modify: `tests/ai-draft-routes.test.ts`

- [x] **Step 1: Write failing prompt tests**

Add tests proving `buildDraftReplyPrompt` and `buildPersonalDraftReplyPrompt` include a trimmed user instruction and warn that instructions cannot override safety or factual constraints.

- [x] **Step 2: Run prompt tests and verify RED**

Run: `npx vitest run tests/ai-draft-provider.test.ts`
Expected: fail because prompt builders do not accept or include `userInstruction`.

- [x] **Step 3: Write failing route tests**

Add tests proving `POST /api/conversations/[id]/draft/suggest` passes `userInstruction` into `generateDraftReply`, stores it in `metadataJson`, and rejects instructions over 500 characters.

- [x] **Step 4: Run route tests and verify RED**

Run: `npx vitest run tests/ai-draft-routes.test.ts`
Expected: fail because the route ignores request JSON and has no instruction validation.

- [x] **Step 5: Implement prompt and route changes**

Add optional `userInstruction?: string | null` to business and personal prompt input types. Render a "User instruction" block only when present. In the route, parse request JSON safely, trim `userInstruction`, reject values over 500 chars, pass the normalized value into prompt generation, and add it to metadata only when present.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/ai-draft-provider.test.ts tests/ai-draft-routes.test.ts`
Expected: pass.

### Task 2: Conversation Panel UI

**Files:**
- Modify: `app/conversations/[id]/AIDraftPanel.tsx`

- [x] **Step 1: Add instruction UI**

Add a controlled `userInstruction` textarea above the suggest button. Keep it optional, disabled while busy, and capped at 500 characters with `maxLength={500}`.

- [x] **Step 2: Send instruction with suggest request**

Update `suggestReply` so it sends JSON only when the trimmed instruction is non-empty. Keep blank behavior as a plain `POST` equivalent.

- [x] **Step 3: Show instruction metadata**

Add `User instruction` to the metadata rows so users can see what guided the current draft.

- [x] **Step 4: Run focused tests**

Run: `npx vitest run tests/ai-draft-provider.test.ts tests/ai-draft-routes.test.ts`
Expected: pass.

### Task 3: Documentation And Verification

**Files:**
- Modify: `docs/CURRENT_STATE.md`
- Modify: `docs/TODO.md`
- Modify: `docs/MASTER_PRODUCT_PLAN.md`
- Modify: `docs/README.md`
- Modify: `docs/superpowers/plans/2026-06-12-intent-auto-draft.md`

- [x] **Step 1: Update docs**

Mark Auto-draft based on user intent shipped, add current-state behavior, update master plan feature #30, add a decision-log row, and add spec/plan links to `docs/README.md`.

- [x] **Step 2: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all commands pass.

- [ ] **Step 3: Commit and open stacked PR**

Commit with `feat: add intent guided draft suggestions`, push `codex/intent-auto-draft`, and open a draft PR targeting `codex/next-plan-work`.
