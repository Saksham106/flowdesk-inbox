# FlowDesk Documentation Index

Last updated: 2026-06-14

Use this directory as the source of truth for product direction, current implementation state, and feature-level plans.

## Living Docs (read these first)

- `../README.md` — local setup, environment variables, connectors, deployment, and scripts.
- `MASTER_PRODUCT_PLAN.md` — living 45-feature roadmap, phase map, decision log, and feature index.
- `CURRENT_STATE.md` — what is currently implemented, what is partial, and what is known to be blocked or deferred.
- `TODO.md` — canonical checklist of remaining work, mapped to the feature index.

## Archive

Historical design specs and implementation plans are in `docs/archive/`:

- `archive/specs/` — design specs written before each feature was built.
- `archive/plans/` — step-by-step implementation plans (checklists now completed).

These are read-only reference. All shipped behavior is documented in `CURRENT_STATE.md`. All roadmap status is in `MASTER_PRODUCT_PLAN.md`.

## Documentation Rules

- Keep `MASTER_PRODUCT_PLAN.md` strategic and phase-oriented.
- Keep `CURRENT_STATE.md` factual and codebase-oriented.
- Keep `TODO.md` as the actionable remaining-work checklist.
- When a feature ships, update all three docs in the same branch as the code change.
- New specs go in `docs/superpowers/specs/`, new plans in `docs/superpowers/plans/` (auto-created by the planning workflow; moved to archive once implemented).
- Do not add new one-off handoff docs when an existing index, state doc, spec, or plan can be updated.

## AI Agent Documentation Contract

Every AI agent working in this repo must keep docs synchronized with code. This is part of the definition of done.

Before starting:

1. Read this file.
2. Read `CURRENT_STATE.md`.
3. Read `MASTER_PRODUCT_PLAN.md`.
4. Read the relevant spec/plan under `docs/superpowers/` or `docs/archive/` if one exists.
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

- `SPRINTS.md` — removed; contained stale checkbox plans from the old email-first reset.
- `docs/AI_DRAFT_MVP_HANDOFF.md` — removed; described old stacked PRs. Still-relevant facts folded into `CURRENT_STATE.md`.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — all historical files moved to `docs/archive/` (2026-06-14). Living docs supersede them.
