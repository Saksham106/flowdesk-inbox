# Design References

These documents preserve durable reasoning for core subsystems. They intentionally omit completed implementation checklists and short-lived handoff notes.

| Reference | Why it is retained |
|---|---|
| [`command-center.md`](command-center.md) | Defines the daily prioritization experience and safety boundaries. |
| [`work-items-and-approvals.md`](work-items-and-approvals.md) | Explains the task, lead, and approval foundations used across features. |
| [`classification.md`](classification.md) | Records classification precedence, confidence, and correction principles. |
| [`email-rendering.md`](email-rendering.md) | Captures the HTML/plain-text rendering and sanitization boundary. |
| [`remote-image-privacy.md`](remote-image-privacy.md) | Records the default-deny remote-image privacy model. |
| [`outlook-sync.md`](outlook-sync.md) | Describes delta cursors, leases, webhook intake, and bounded workers. |

These are point-in-time design records. For current behavior and limitations, use [`../CURRENT_STATE.md`](../CURRENT_STATE.md) and verify against source code.
