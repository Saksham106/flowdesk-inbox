# Task 4: AI Eligibility Check Prompt — Implementation Report

## Status
**DONE**

## Summary
Successfully implemented Task 4, creating a new standalone file `lib/ai/prompts/draft-eligibility.ts` that provides a prompt builder and JSON-schema/output-normalizer pair for determining whether an email genuinely expects a personal reply or is one-way mail (newsletter, notification, etc.).

## Implementation Details

### Files Created
1. **lib/ai/prompts/draft-eligibility.ts** (89 lines)
   - Exports types: `DraftEligibilityPromptInput`, `DraftEligibilityResult`
   - Exports JSON schema: `draftEligibilityJsonSchema`
   - Exports functions:
     - `buildDraftEligibilityPrompt()`: Constructs prompt with subject, body, and eligibility reasoning
     - `normalizeDraftEligibilityOutput()`: Parses and validates AI response JSON
   - Defines two const arrays: `EMAIL_TYPES` (6 types) and `ATTENTION_CATEGORIES` (7 categories)
   - Uses utility functions: `truncate()`, `isRecord()`
   - Imports `stripHtmlToText` from `@/lib/email-body` as specified

2. **tests/draft-eligibility-prompt.test.ts** (68 lines)
   - Test suite with 5 tests covering:
     - Prompt inclusion of subject and body
     - Valid needsReply=false response parsing
     - Valid needsReply=true response parsing
     - Invalid JSON error handling
     - Invalid suggestedEmailType error handling

### Pattern Consistency
The implementation follows the exact same patterns as the existing `lib/ai/prompts/draft-reply.ts`:
- JSON schema structure with `type`, `properties`, `required`, `additionalProperties: false`
- Type exports for both input and result objects
- Normalization function with strict validation and error messages
- Utility helper functions for truncation and type checking
- Prompt builder using array.join("\n") for clean multiline strings

### Validation
All 5 implementation tests pass (5/5):
- buildDraftEligibilityPrompt includes subject and body
- normalizeDraftEligibilityOutput correctly parses valid responses
- Error handling for invalid JSON
- Error handling for invalid enum values

### Quality Checks
- Full test suite: 1192 tests pass (142 files)
- TypeScript compilation: No errors
- ESLint: No new linting issues (9 pre-existing warnings unrelated to this task)
- All required checks pass: `npm test`, `npx tsc --noEmit`, `npm run lint`

## Commit
**Commit SHA:** e237662
**Commit Message:** feat: add AI draft-eligibility prompt and schema

## Dependencies
No external dependencies added. Implementation uses:
- Existing `stripHtmlToText` from `@/lib/email-body` as specified
- Standard TypeScript types and runtime validation

## Ready for Task 5
This implementation provides all interfaces required by Task 5 (`resolveDraftEligibility`):
- `buildDraftEligibilityPrompt(input: DraftEligibilityPromptInput): string`
- `draftEligibilityJsonSchema: Record<string, unknown>`
- `normalizeDraftEligibilityOutput(rawText: string): DraftEligibilityResult`
- Types: `DraftEligibilityPromptInput`, `DraftEligibilityResult`

## No Concerns
All steps completed successfully. Code is production-ready.
