# Default Rules and Recent Email Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show all built-in canonical label rules with real enabled state and replace Assistant History’s primary surface with 20 recent, correctable emails.

**Architecture:** A pure presenter maps canonical labels plus optional Gmail mappings into built-in rule rows. Rules loads those mappings beside existing custom rules. History server-loads recent conversations and rule audits in parallel; a focused client component adjusts labels through the existing unified correction endpoint.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5, Prisma 5, Tailwind CSS 4, Vitest 2.

## Global Constraints

- No schema migration, seed data, duplicate label vocabulary, or new mutation endpoint.
- Absence of `GmailLabelMapping` means enabled.
- Recent history is tenant-scoped, newest first, and limited to 20.
- Corrections use `PATCH /api/conversations/[id]/flowdesk-label` and `FLOWDESK_LABEL_OPTIONS`.
- Rule audit history remains available in a collapsed disclosure.

---

### Task 1: Built-In Rule Presenter and Rules UI

**Files:** Create `lib/built-in-rule-view.ts`, create `tests/built-in-rule-view.test.ts`, modify `app/assistant/rules/page.tsx`, modify UI contracts.

- [ ] Write failing tests for canonical order, absent-means-enabled, explicit mappings, and non-empty descriptions.
- [ ] Run focused test and confirm RED.
- [ ] Implement `builtInRuleRows(mappings)` using `FLOWDESK_GMAIL_LABEL_NAMES`.
- [ ] Add failing Rules source contracts for the built-in heading, Enabled/Disabled copy, and `/settings/gmail` link.
- [ ] Load mappings in the existing parallel Rules query and render the built-in section separately from user-rule stats.
- [ ] Run focused tests and TypeScript; commit `feat(assistant): show built-in label rules`.

### Task 2: Recent Email Correction History

**Files:** Create `app/assistant/RecentEmailHistory.tsx`, modify `app/assistant/history/page.tsx`, modify UI contracts.

- [ ] Add failing contracts for tenant-scoped newest-first `take: 20`, `FLOWDESK_LABEL_OPTIONS`, `currentFlowDeskLabel`, and `/flowdesk-label`.
- [ ] Run focused tests and confirm RED.
- [ ] Query/normalize 20 recent conversations and rule audit entries in parallel.
- [ ] Implement responsive recent-email rows with Adjust, visible label select, Save/Cancel, pending state, optimistic success, and `aria-live` failure.
- [ ] Move `RuleHistoryList` under a closed native details disclosure.
- [ ] Run focused tests and TypeScript; commit `feat(assistant): add recent email corrections`.

### Task 3: Regression, Documentation, and Integration Readiness

**Files:** Update `docs/CURRENT_STATE.md`; modify only files required by verification failures.

- [ ] Run full tests, lint, and production build.
- [ ] Apply React best-practices review.
- [ ] Attempt authenticated browser verification; report the existing local migration blocker if it remains.
- [ ] Document built-in rule visibility and recent-email correction behavior.
- [ ] Run `git diff --check`; commit `docs: record assistant learning history`.
- [ ] Run the finishing/verification workflow before merging to main.
