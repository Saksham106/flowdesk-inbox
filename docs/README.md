# Documentation

FlowDesk keeps these living documentation entry points:

- [`../README.md`](../README.md): setup, connectors, environment variables, and deployment.
- [`product-direction.md`](product-direction.md): Gmail-native product strategy and positioning.
- [`CURRENT_STATE.md`](CURRENT_STATE.md): what is implemented, how key subsystems work, and the important limitations.
- [`MASTER_PRODUCT_PLAN.md`](MASTER_PRODUCT_PLAN.md): product thesis, feature index with statuses, decision log, and open questions.
- [`TODO.md`](TODO.md): the actionable engineering backlog.
- [`google-oauth-verification.md`](google-oauth-verification.md): Google OAuth app verification runbook — consent-screen/client configuration, scope justifications, demo-video checklist, and the annual CASA renewal.
- [`storage-and-capacity.md`](storage-and-capacity.md): database storage runbook — what grows and what bounds it (retention windows, write gating), how to read Railway volume numbers, capacity math per user, do-not-prune warnings, and deferred storage decisions with revisit triggers.

Completed specs, implementation plans, GitHub audits, and one-time review notes live in Git history, not the working tree. Update an existing living document when its source of truth changes; do not add handoff files or retain completed checklists.

Before starting a feature: read `CURRENT_STATE.md`, `TODO.md`, and the source code. Update only the documents affected by the change.
