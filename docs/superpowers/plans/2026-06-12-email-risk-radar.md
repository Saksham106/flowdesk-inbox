# Email Risk Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `/risk-radar` view that surfaces deadline-soon, final-notice, unanswered, and sensitive-content inbox risks.

**Architecture:** Add a pure deterministic helper in `lib/agent/risk-radar.ts`, then consume it from an auth-gated server page at `app/risk-radar/page.tsx`. Reuse existing conversation/message/draft data and centralized inbox navigation; no schema changes.

**Tech Stack:** Next.js App Router, React Server Components, Prisma, TypeScript, Vitest.

---

### Task 1: Pure Risk Radar Helper

**Files:**
- Create: `lib/agent/risk-radar.ts`
- Create: `tests/risk-radar.test.ts`

- [x] **Step 1: Write failing helper tests**

Create `tests/risk-radar.test.ts` with tests for deadline language, final notices, unanswered age threshold, sensitive metadata/text detection, sorting, grouping, and unique total counts.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/risk-radar.test.ts`
Expected: fail because `@/lib/agent/risk-radar` does not exist.

- [x] **Step 3: Implement helper**

Create `lib/agent/risk-radar.ts` with exported types `RiskRadarSignal`, `RiskRadarPriority`, `RiskRadarInputConversation`, `RiskRadarItem`, `RiskRadar`, and function `buildRiskRadar(conversations, now = new Date())`. Use deterministic regexes for deadline, final-notice, unanswered, and sensitive signals. Keep helper pure and side-effect free.

- [x] **Step 4: Run focused test and verify GREEN**

Run: `npx vitest run tests/risk-radar.test.ts`
Expected: all Risk Radar tests pass.

### Task 2: Risk Radar Page And Navigation

**Files:**
- Create: `app/risk-radar/page.tsx`
- Modify: `lib/app-navigation.ts`
- Test: `tests/client-navigation.test.ts`

- [x] **Step 1: Add failing navigation test**

Update `tests/client-navigation.test.ts` so business navigation includes `{ label: "Risk Radar", href: "/risk-radar" }`.

- [x] **Step 2: Run navigation test and verify RED**

Run: `npx vitest run tests/client-navigation.test.ts`
Expected: fail because the link is not present.

- [x] **Step 3: Add navigation link**

Modify `lib/app-navigation.ts` to add Risk Radar to `BUSINESS_SECONDARY`, near Reports and Approvals.

- [x] **Step 4: Create server page**

Create `app/risk-radar/page.tsx`. Authenticate with `getServerSession(authOptions)`, redirect to `/login` when unauthenticated, load up to 200 tenant-scoped conversations ordered by `lastMessageAt desc`, include `messages`, `channel`, `contact`, and `draft`, call `buildRiskRadar`, and render summary counters plus four grouped lists.

- [x] **Step 5: Run focused tests**

Run: `npx vitest run tests/risk-radar.test.ts tests/client-navigation.test.ts`
Expected: pass.

### Task 3: Documentation And Verification

**Files:**
- Modify: `docs/CURRENT_STATE.md`
- Modify: `docs/TODO.md`
- Modify: `docs/MASTER_PRODUCT_PLAN.md`

- [x] **Step 1: Update docs**

Mark Email Risk Radar shipped in `docs/TODO.md`, add current-state bullets under implemented foundations, update #22 status in `docs/MASTER_PRODUCT_PLAN.md`, and add a decision-log row.

- [x] **Step 2: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all commands pass.

- [x] **Step 3: Commit and open PR**

Stage the implementation, commit with `feat: add email risk radar`, push `codex/next-plan-work`, and create a draft PR.
