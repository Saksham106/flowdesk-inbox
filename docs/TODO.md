# Remaining Work

Last updated: 2026-07-06

## Near term

- [ ] Bootstrap FlowDesk Gmail labels on account connect and scheduled maintenance.
- [ ] Apply Gmail label projection after classification and draft creation, not only manual workflow/status changes.
- [ ] Create real Gmail drafts for proposed replies, dedupe by thread/latest message, and store provider draft IDs.
- [ ] Add automation level settings for Gmail-native actions before expanding auto-read/archive/send behavior.
- [ ] Track sent threads waiting for replies and apply `Waiting On` / `Follow Up` Gmail labels.
- [ ] Update dashboard/settings copy and indicators so the website reads as the agent control room.
- [ ] Consolidate command-center and inbox auto-email/classification heuristics.
- [ ] Persist command-center snapshots for history and explainability.
- [ ] Show classification source, confidence, evidence, and correction history.
- [ ] Add manual sender/domain rule creation, editing, and conflict handling.
- [ ] Decide and implement Outlook archive/trash/unsubscribe parity.
- [ ] Implement CC/BCC send support and re-enable compose fields once the APIs persist those recipients end-to-end.
- [ ] Broaden Gmail inline `cid:` image support beyond the current size-capped safe embedding path.

## Finish existing foundations

- [ ] Complete scheduling confirmation and event booking.
- [ ] Add a workflow-template builder.
- [ ] Inject connected Google Drive context into draft generation.
- [ ] Add semantic knowledge/search retrieval and scheduled website recrawling.
- [ ] Make lead-sequence timing configurable and visible.
- [ ] Add user-visible AI budget/usage visibility for inbox chat and agent-rule compilation.

## Later

- [ ] Design the team/shared-inbox data and permission model.
- [ ] Enforce free, personal, business, and team packaging in code.
- [ ] Document customer-facing privacy, retention, security, and audit posture.
