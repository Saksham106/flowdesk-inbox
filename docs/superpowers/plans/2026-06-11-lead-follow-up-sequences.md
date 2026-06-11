# Lead Follow-Up Sequences — Implementation Plan

Date: 2026-06-11
Design: `docs/superpowers/specs/2026-06-11-lead-follow-up-sequences-design.md`

## Steps

1. `lib/agent/lead-sequence.ts`
   - `LEAD_SEQUENCE_STEPS` constant (3 steps: 2/4/7 quiet days).
   - `readSequenceState(metadataJson)` — tolerant parse of `Lead.metadataJson.followUpSequence`.
   - `getNextSequenceStep(input)` — pure; stage gate, inbound-pause, step anchor, due check.
   - `runLeadSequenceBatch(tenantId?)` — query active leads with latest message, dedupe on recent `lead_follow_up` jobs, create `AgentJob`, merge sequence state into `metadataJson`, write audit log. Returns `{ processed, skipped, failed }`.
2. `app/api/cron/lead-sequence/route.ts` — CRON_SECRET-protected GET, mirrors follow-up cron.
3. `app/leads/page.tsx` — sequence progress line per lead row.
4. `app/inbox/page.tsx` — follow-up tracker query includes `lead_follow_up` trigger.
5. `tests/lead-sequence.test.ts` — pure-function coverage (state parse, step gating, anchoring, terminal step) and batch coverage (queue + state + audit, closed-conversation skip, dedupe skip, not-due skip, metadata preservation, failure isolation) using the hoisted-mock prisma pattern.
6. Docs: update `CURRENT_STATE.md`, `MASTER_PRODUCT_PLAN.md` feature index (#4) and decision log, check off `docs/TODO.md`.

## Verification

```bash
npx vitest run tests/lead-sequence.test.ts
npm test
npm run lint
npm run build
```
