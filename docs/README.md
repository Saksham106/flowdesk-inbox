# FlowDesk Documentation Index

Last updated: 2026-06-11

Use this directory as the source of truth for product direction, current implementation state, and feature-level plans.

## Start Here

- `../README.md` — local setup, environment variables, connectors, deployment, and scripts.
- `MASTER_PRODUCT_PLAN.md` — living 45-feature roadmap and phase map.
- `CURRENT_STATE.md` — what is currently implemented, what is partial, and what is known to be blocked or deferred.

## Feature Specs And Plans

- `superpowers/specs/2026-06-11-daily-command-center-design.md` — design for the first Daily Command Center slice.
- `superpowers/plans/2026-06-11-daily-command-center.md` — implementation plan and verification notes for the first Daily Command Center slice.
- `superpowers/specs/2026-06-11-task-lead-approval-foundation-design.md` — design for persisted tasks, leads, conversation state, and approval queue foundations.
- `superpowers/plans/2026-06-11-task-lead-approval-foundation.md` — implementation plan and verification notes for the task/lead/approval foundation slice.
- `superpowers/specs/2026-06-12-email-risk-radar-design.md` — design for the read-only Email Risk Radar view.
- `superpowers/plans/2026-06-12-email-risk-radar.md` — implementation plan for the Email Risk Radar slice.
- `superpowers/specs/2026-06-12-intent-auto-draft-design.md` — design for rough-instruction guided AI draft suggestions.
- `superpowers/plans/2026-06-12-intent-auto-draft.md` — implementation plan for the intent auto-draft slice.

## Documentation Rules

- Keep `MASTER_PRODUCT_PLAN.md` strategic and phase-oriented.
- Keep `CURRENT_STATE.md` factual and codebase-oriented.
- Keep detailed implementation steps in `docs/superpowers/plans/`.
- When a feature ships, update both its detailed plan and the status row in `MASTER_PRODUCT_PLAN.md`.
- Do not add new one-off handoff docs when an existing index, state doc, spec, or plan can be updated.

## AI Agent Documentation Contract

Every AI agent working in this repo must keep docs synchronized with code. This is part of the definition of done.

Before starting:

1. Read this file.
2. Read `CURRENT_STATE.md`.
3. Read `MASTER_PRODUCT_PLAN.md`.
4. Read the relevant spec/plan under `docs/superpowers/` if one exists.
5. Check `git status --short` and avoid overwriting unrelated work.

During implementation:

- Update an existing doc instead of creating a duplicate.
- If a plan checkbox becomes true, mark it and add verification notes.
- If the implementation differs from the plan, update the plan or decision log instead of leaving the mismatch.
- If a feature is only partially implemented, say so explicitly.
- If a planned item is deferred or deleted, explain why and where the new source of truth lives.

Before finishing:

1. Update `CURRENT_STATE.md` for factual implementation changes.
2. Update `MASTER_PRODUCT_PLAN.md` when roadmap status, phase, or next-slice recommendations change.
3. Update `README.md` when setup, commands, environment variables, connectors, or deployment steps change.
4. Update `.github/copilot-instructions.md` if repo-wide agent behavior expectations change.
5. Run relevant verification and record blocked checks in the final response or the relevant plan.

Stale docs are treated as bugs. A future teammate or agent should never have to guess which Markdown file is true.

## Removed Or Consolidated Docs

- `SPRINTS.md` was removed because it contained stale checkbox plans from the old email-first reset and duplicated the master plan.
- `docs/AI_DRAFT_MVP_HANDOFF.md` was removed because it described old stacked PRs and outdated limitations. Its still-relevant facts were folded into `CURRENT_STATE.md`.
