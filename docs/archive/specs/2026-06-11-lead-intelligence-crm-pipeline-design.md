# Lead Intelligence + CRM Pipeline — Design Spec

Date: 2026-06-11
Phase: 2 — Business Revenue Inbox Agent
Features: #7 (Lead scoring refinement), #40 (Email triage by money impact)

## Goal

Replace the deterministic lead scoring heuristic with an LLM-based scorer that extracts intent signals, explains the score in plain language, and estimates deal value. Surface the improved intelligence on the `/leads` CRM pipeline page and in the daily command center's opportunity section.

## Background

The `Lead` model and extraction pipeline already exist. The current score is a heuristic: `55 + up to 45 points` based on regex matches for label, company presence, budget language, and urgency keywords. It produces no explanation and no value estimate. The `/leads` page already sorts by score but shows no reasoning. The command center opportunity section uses in-memory signals rather than the persisted lead score.

## Architecture

Three self-contained parts:

1. **LLM lead scorer** (`lib/agent/lead-scoring.ts`) — pure function, testable without DB.
2. **Schema extension** — three nullable columns on `Lead`.
3. **UI upgrades** — `/leads` funnel header + score badges; command center opportunity cards use DB score.

## Schema Changes

Add to the `Lead` model in `prisma/schema.prisma`:

```prisma
scoreExplanation String?
estimatedValue   Int?       // rough dollars, null if no signals
scoredAt         DateTime?
```

All nullable — no existing rows break. One migration file required.

## LLM Scorer (`lib/agent/lead-scoring.ts`)

### Input

- Last 20 messages from the conversation (truncated to ~300 chars each, direction-labeled).
- Existing lead fields: `need`, `urgency`, `budgetClue`.

### Output (structured JSON)

```ts
{
  score: number            // 1–100
  scoreExplanation: string // 1–2 sentences on what drove the score
  estimatedValue: number | null
  need: string             // refined
  urgency: "low" | "medium" | "high"
  budgetClue: string | null
}
```

### Scoring rubric (in prompt)

| Range | Meaning |
|-------|---------|
| 80–100 | Explicit intent: demo request, "ready to move forward", specific pricing ask with timeline |
| 60–79 | Moderate intent: qualifying question, named use case, budget range mentioned |
| 40–59 | Early interest: vague inquiry, "just looking", no urgency |
| <40 | Weak signal: generic question, unlikely buyer |

### Re-scoring guard

- Skipped if `lead.scoredAt` is non-null and `conversation.updatedAt <= lead.scoredAt`.
- Always runs on `POST /api/leads/[id]/score` (on-demand).
- If the LLM call fails, the existing heuristic score is left intact (no overwrite on error).

### Fallback

The deterministic extractor in `lib/agent/work-items.ts` remains unchanged as the initial score. `scoredAt` stays null until the LLM scorer runs, so the heuristic score is always a valid fallback.

## Data Flow

```
work-item-sync.ts
  └─ upsertLead(draft)          ← deterministic extraction, fast
  └─ scoreLead(leadId) async    ← fire-and-forget, only if scoredAt null

conversation.updatedAt > lead.scoredAt?
  └─ yes → scoreLead()
  └─ no  → skip

POST /api/leads/[id]/score
  └─ always calls scoreLead()
  └─ returns updated lead fields
```

`scoreLead()` writes `score`, `scoreExplanation`, `estimatedValue`, `scoredAt`, `need`, `urgency`, `budgetClue` in a single `prisma.lead.update`.

## API

### `POST /api/leads/[id]/score`

- Auth: session required, tenant-scoped.
- Loads the lead + last 20 messages.
- Calls `scoreLead()`.
- Returns `{ score, scoreExplanation, estimatedValue, scoredAt }`.
- Audited as `lead.scored` with `{ leadId, score, source: "llm" }`.

## UI Changes

### `/leads` page

**Funnel header** (above the lead list):

- Five stage chips: new / contacted / qualified / won / lost.
- Each chip shows: count + sum of `estimatedValue` for that stage (e.g. "3 leads · ~$1,200").
- Chips are informational only (no filter behavior in this slice).

**Lead card additions:**

- Score badge next to company name: green (70+), amber (40–69), gray (<40).
- `scoreExplanation` shown as a subtitle line beneath the need description.
- `estimatedValue` shown inline when non-null (e.g. "~$500 est.").
- Re-score icon button (refresh icon): calls `POST /api/leads/[id]/score`, updates card optimistically.

### Command center (`lib/agent/command-center.ts` + `CommandCenterPanel.tsx`)

- When computing opportunity briefings, join the `Lead` record for the conversation if it exists.
- If `lead.score >= 70`, use `lead.scoreExplanation` as the opportunity card description instead of the generic "Potential revenue or booking opportunity."
- Display the score as a badge on the opportunity card in the command center panel.

## Out of Scope (this slice)

- Sales agent mode (#20) — separate slice.
- CRM filter/search on `/leads` — follow-up slice.
- Value forecasting or pipeline trends — Phase 2 ROI analytics slice.
- Batch re-scoring of all existing leads — can be done on-demand or via a future cron.
- Sequence settings UI — already punted in the lead follow-up sequences design.

## Testing

- Unit tests for `scoreLead()` (mock OpenAI, assert structured output normalization).
- Unit test for the re-scoring guard (skip when `scoredAt >= conversation.updatedAt`).
- Existing `tests/work-items.test.ts` and `tests/lead-sequence.test.ts` must continue to pass.

## Success Criteria

- A lead with "We're evaluating vendors and have a $2k/month budget, can we book a demo this week?" scores 85+ with a meaningful explanation.
- A lead with "Do you do dental stuff?" scores below 50.
- `/leads` page shows the funnel header with per-stage value estimates.
- Command center opportunity cards show the LLM explanation when score >= 70.
- Re-score button updates the card without a full page reload.
