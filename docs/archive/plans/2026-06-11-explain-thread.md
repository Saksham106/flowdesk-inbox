# Explain This Thread — Implementation Plan

Date: 2026-06-11
Design: `docs/superpowers/specs/2026-06-11-explain-thread-design.md`

## Steps

1. `lib/ai/prompts/explain-thread.ts` — input/result types, strict JSON schema, `buildExplainThreadPrompt` (25-message window, truncation, direction labels, safety rules), `normalizeExplainThreadOutput` (tolerant parsing, riskLevel fallback to medium, array filtering).
2. `lib/ai/openai.ts` — `explainThreadWithOpenAI` using the structured-output pattern.
3. `lib/ai/provider.ts` — `explainThread` wrapper.
4. `app/api/conversations/[id]/explain/route.ts` — POST: auth, tenant-scoped conversation fetch (40 messages), empty-thread guard, provider call with 502/503 error mapping, `AiUsageEvent` on success and failure, `conversation.explained` audit entry.
5. `app/conversations/[id]/ExplainThreadPanel.tsx` — client panel; added to the conversation page sidebar below Handle This.
6. `tests/explain-thread.test.ts` — prompt content/truncation/windowing and normalizer parsing/fallbacks/filtering.
7. Docs: `CURRENT_STATE.md`, master plan feature index (#15) and decision log, check off `docs/TODO.md`.

## Verification

```bash
npx vitest run tests/explain-thread.test.ts
npm test
npm run lint
npm run build
```

Note: end-to-end visual QA requires `OPENAI_API_KEY` and a seeded conversation; in environments without local Postgres this is blocked, so verification is tests + build.
