# Explain This Thread — Design

Date: 2026-06-11

## Problem

Long threads are painful. Feature #15 of the master plan ("Explain This Thread Like I'm Busy") calls for a per-thread answer to: what happened, what do they want, what do I need to do, and what is risky — more than a summary, because it surfaces deadlines, money, and commitments the user already made. This is the first LLM summary surface in the product.

## Goal

A one-click panel on conversation pages that produces a busy-person explanation of the thread, with a visible risk level, using the existing OpenAI structured-output infrastructure.

## Output Shape

```
whatHappened       string   1-3 sentences
whatTheyWant       string   1-2 sentences
whatYouNeedToDo    string[] imperative action items (may be empty)
risks              string[] deadlines, money, prior commitments, sensitivity
riskLevel          enum     low | medium | high
suggestedNextStep  string?  single best next action
```

`riskLevel` is high for legal/medical/financial/refund/contract/angry-sender content, medium for deadlines or money, low otherwise. The prompt forbids inventing facts and forbids advising the user to admit legal liability (flag it as a risk instead) — consistent with the master plan's trust rules.

## Architecture

- `lib/ai/prompts/explain-thread.ts` — prompt builder (last 25 messages, 2,500-char truncation per message, direction-labeled), strict JSON schema, tolerant normalizer. Pure and unit-tested.
- `lib/ai/openai.ts` + `lib/ai/provider.ts` — `explainThreadWithOpenAI` / `explainThread`, mirroring the draft-reply pattern (structured outputs, `OPENAI_MODEL`).
- `POST /api/conversations/[id]/explain` — auth + tenant-scoped fetch, calls the provider, records an `AiUsageEvent` (`explain_thread`, succeeded/failed), writes a `conversation.explained` audit-log entry with risk level and counts.
- `app/conversations/[id]/ExplainThreadPanel.tsx` — client panel below Handle This: explain button → sections + risk badge + refresh. Explanations are generated on demand and not persisted.

## Trust & Safety

- Read-only: the feature never drafts, sends, or changes conversation state.
- Every run is audited and usage-tracked.
- Works for both personal and business accounts (no business-profile requirement).

## Out Of Scope

- Persisting explanations or showing them in the inbox list.
- Feeding explanations into draft generation or the command center.
- Streaming responses.
