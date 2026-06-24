# Documentation

FlowDesk keeps four living documents:

- [`../README.md`](../README.md): setup, connectors, environment variables, and deployment.
- [`CURRENT_STATE.md`](CURRENT_STATE.md): what is implemented and the important limitations.
- [`MASTER_PRODUCT_PLAN.md`](MASTER_PRODUCT_PLAN.md): product direction and phase priorities.
- [`TODO.md`](TODO.md): the actionable engineering backlog.

Completed specs and implementation plans live in Git history, not the working tree. Update an existing living document when its source of truth changes; do not add handoff files or retain completed checklists.

## Design references

`reference/` preserves the few designs that explain important system boundaries:

- command center and work-item foundations
- classification and email rendering
- remote-image privacy and Outlook delta sync

These are point-in-time design records, not current-status checklists. Code and `CURRENT_STATE.md` win if implementation details have changed.

Before broad work, read `CURRENT_STATE.md`, `TODO.md`, the relevant reference when one exists, and the source code. Update only the documents affected by the change.
