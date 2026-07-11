# Task 1/3 P1 Fix Report

## Fixed findings

1. Gmail label writeback suppression is now single-use. A matching completed
   writeback is atomically moved to `acknowledged`; subsequent matching Gmail
   label edits are handled as user feedback.
2. Reply-style training no longer accepts `flowdesk_database` outbound samples.
   It always fetches Gmail Sent samples when a channel is available, retaining
   database candidates only as an `unverified_database` exclusion statistic.

## Regression coverage

- A completed FlowDesk label echo is ignored once, while a later matching edit
  is applied.
- Database-only outbound history cannot train a learned reply profile.

## Verification

- `npm test -- tests/gmail-label-feedback.test.ts tests/reply-learning.test.ts tests/google-sent-samples.test.ts`
  - 3 files passed, 19 tests passed.
- `npx tsc --noEmit`
  - exited successfully.
