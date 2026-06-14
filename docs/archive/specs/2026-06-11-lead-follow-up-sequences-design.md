# Lead Follow-Up Sequences — Design

Date: 2026-06-11

## Problem

The follow-up brain queues generic stale-conversation follow-ups, but leads — the conversations most directly tied to revenue — get no staged treatment. A lead that goes quiet should receive an escalating sequence (gentle nudge → value reminder → polite close), not the same single reminder as any other thread. This is the last open item of the "Follow-Up Brain And Relationship Memory" slice.

## Goal

Active leads whose conversations go quiet are automatically queued through a three-step follow-up sequence, visible on the leads page, with every step audited.

## Sequence Definition

| Step | Name | Due after quiet days |
|---|---|---|
| 1 | `first_follow_up` | 2 |
| 2 | `second_follow_up` | 4 (after step 1) |
| 3 | `closing_follow_up` | 7 (after step 2) |

Rules:

- Only leads in active stages (`new`, `contacted`, `qualified`) participate. `won`/`lost` leads and closed conversations are skipped.
- If the last message in the conversation is inbound, the lead replied — the thread needs a user reply, not an automated nudge. The sequence pauses.
- Each step is anchored on the later of the previous step time and the last message time.
- After the closing step, the sequence ends; no further automation.

## Architecture

- `lib/agent/lead-sequence.ts` — pure step computation (`getNextSequenceStep`, `readSequenceState`) plus `runLeadSequenceBatch`.
- Sequence state lives in `Lead.metadataJson.followUpSequence` (`{ lastStep, lastStepAt }`). No schema migration needed; the local migration workflow requires a running Postgres, which is not guaranteed in agent environments.
- Each due step creates an `AgentJob` with trigger `lead_follow_up` and `slotsJson` `{ leadId, step, stepName }` — mirroring the existing `follow_up` trigger so draft generation stays on-demand and no OpenAI calls happen from cron.
- Dedupe: skip a lead if a `lead_follow_up` job was created for its conversation in the last 24 hours.
- Audit: every queued step writes `lead_sequence.step_queued` to the audit log.
- Cron: `GET /api/cron/lead-sequence` protected by `CRON_SECRET`, mirroring `/api/cron/follow-up`.

## UI

- `/leads`: rows show "Follow-up N of 3 queued · date" when a sequence has started.
- `/inbox` follow-up tracker now includes `lead_follow_up` jobs alongside `follow_up` jobs.

## Trust & Safety

- Sequences queue jobs only; nothing is sent automatically. Drafting and sending remain behind the existing policy/autopilot/approval gates.
- Every step is auditable and attributable to a rule (`lead_sequence.step_queued` payload includes lead, conversation, step).

## Out Of Scope

- LLM-generated sequence copy (drafting stays on-demand per job).
- User-configurable step timings (use `FollowUpSetting`-style settings later if demanded).
- Sequence pause/cancel UI (changing lead stage to `won`/`lost` or closing the conversation already stops it).
