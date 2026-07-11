# Task 4: Enforceable Writing Preferences

## Delivered

- Added tenant-scoped `WritingPreference` persistence with a Prisma migration. Preferences cover em-dash prohibition, greetings, avoided phrases, signoffs, formality, reply length, and a custom instruction.
- Added authenticated `GET` and `PATCH /api/writing-preferences` handlers. PATCH ignores request-supplied tenant identity, bounds string arrays to 20 normalized values of 120 characters, and bounds the custom instruction to 1,000 characters.
- Added `validateDraftWritingPreferences`, which enforces the em-dash prohibition and avoided phrases case-insensitively.
- Loaded writing preferences into reply-generation context and injected them after learned style in both personal and business prompt builders, explicitly stating that they override learned style.
- Draft generation now validates before persistence. A violating response gets one regeneration pass containing the failures. A second violating response returns HTTP 422 and is not stored.
- Added a labelled **Never use em dashes** switch, custom instruction field, save action, and saved state to the Training settings page.

## Test-first evidence

Initial focused run failed as expected because the writing-preferences helper did not exist and the personal prompt lacked the explicit-preferences block. After implementation, all focused tests passed.

## Verification

- `npx prisma generate`
- `npx vitest run tests/writing-preferences.test.ts tests/ai-draft-provider.test.ts tests/personal-profile-route.test.ts` — 15 passing tests
- `npx vitest run tests/ai-draft-routes.test.ts tests/agent-context.test.ts tests/settings-tabs.test.ts` — 20 passing tests
- `npx tsc --noEmit` — passed
- `npm run lint` — passed with 8 existing `next/no-img-element` warnings in landing-page components; no errors
- `git diff --check` — passed

## Deployment note

The migration has been created but not applied to a production database. Deploy it with the project’s normal production migration command before enabling the new settings route in production.

## Review follow-up: editable preference controls

- Added comma-separated editable inputs for preferred greetings, avoided phrases, and preferred sign-offs, plus formality and reply-length selectors. Each control updates the same preference draft saved by the existing `PATCH /api/writing-preferences` action, alongside the existing em-dash toggle and custom instruction.
- Added a focused UI contract test that requires labelled, controlled inputs for all persisted preference fields.
- `npx vitest run tests/writing-preferences.test.ts tests/personal-profile-route.test.ts tests/ai-draft-provider.test.ts` — 16 passing tests.
- `npx eslint app/settings/PersonalStylePanel.tsx tests/writing-preferences.test.ts` — passed.
- `git diff --check` — passed.
- `npx tsc --noEmit` remains blocked by unrelated pre-existing Task 1/3 errors: `lib/agent/gmail-label-feedback.ts` has a Prisma JSON type mismatch and `lib/conversation-labels.ts` references a missing `gmailLabelOverride` property.
