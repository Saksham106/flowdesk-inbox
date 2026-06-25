# GitHub Audit — 2026-06-25
## Summary
Last 7 days show strong velocity across Outlook sync, email privacy hardening, workflow UX, and landing-page polish. Main risk is documentation drift: README and CURRENT_STATE are still inconsistent on several shipped behaviors, and the clean-inbox dashboard target metadata fields were expanded by #62 without schema migration yet. Good test coverage added for new areas; direct pushes to main are uncontroversial docs/UX fixes from the repo owner.

## Merged PRs
### #68 feat: redesign landing page to match Figma design
- **Author:** Mehmet Battal | **Merged:** 2026-06-24
- **Intent:** Full visual overhaul matching Figma.
- **Reality:** Replaced landing layout, fonts, static assets, OG metadata; updated `README.md` and `CURRENT_STATE.md`.
- **Rating:** Healthy
- **Findings:**
  - [P3] `public/images/landing/*` binaries are non-text; confirm `.gitignore` excludes large generated assets at build time | — | fix: confirm CI/build ignores generated `public/images` copies

### #67 feat: durable hybrid Outlook delta sync (#42)
- **Author:** Saksham Goel | **Merged:** 2026-06-24
- **Intent:** Durable Microsoft Graph delta sync with webhook, subscription, worker.
- **Reality:** Prisma migration adds `OutlookCredential` sync lease/cursor/subscription fields and `OutlookSyncEvent` queue. `lib/outlook-sync.ts` implements lease-gated bounded paging, 410 cursor reset, encrypted cursor, `affectedConversationIds` work-item sync, `applyRemovedMessage` closing empty conversations. `lib/outlook-worker.ts` batches claimed events, renews subscriptions, stale fallback. Tests exist for paging, lease atomicity, cursor reset, removed-message close, skip-if-busy.
- **Rating:** Healthy
- **Findings:**
  - [P1] Webhook endpoint returns `{ id, channelId, tenantId, ... }` shape consumers rely on contract | `app/api/connectors/outlook/webhook/route.ts` | fix: add response schema doc + integration test asserting 202 shape
  - [P2] `processOutlookSyncWork` swallows leaf errors with `catch { errors++ }` without attaching `lastError` for subscription renewals | `lib/outlook-worker.ts:100` | fix: log/`auditLog` the renewal failure cause for observability
  - [P2] `applyLiveMessage` reuses `phoneE164` for email as the unique contact key; if someone connects both Gmail and Outlook, email and SMS contacts collide under the same unique constraint | `lib/outlook-sync.ts:135` | fix: add `emailAddress` column/uniqueness on Contact or composite `(tenantId, provider, externalId)` key

### #66 [codex] Block remote email images by default
- **Author:** Saksham Goel | **Merged:** 2026-06-24
- **Intent:** Privacy-safe rendering: block remote images, strip dark-mode/viewport, prevent newsletter zoom.
- **Reality:** New CSP handles network isolation; `stripEmailViewportMeta` and stricter CSS rules; regression tests added. Commit notes are specific about root cause and fix. Existing inline `max-width` preserves retina icon sizing; `!important` kept on `height: auto`.
- **Rating:** Healthy
- **Findings:**
  - [P2] Remote image opt-in is per-message/non-persistent; consider adding a “Remember for this sender” opt-in to reduce repeat clicks as a UX follow-up | — | fix: roadmap item, not blocking

### #63 fix: conversation page crash and sidebar/dashboard FYI sync
- **Author:** Shivansh Goel | **Merged:** 2026-06-18
- **Intent:** Fix conversation page crash, align sidebar with command-center FYI classification.
- **Reality:** Likely crash fix + UI state sync; tests added for inbox FYI, automation runner, clean-inbox batch, work-item sync.
- **Rating:** Healthy
- **Findings:**
  - [P1] `InboxTask.deterministicKey` uniqueness implies same email across re-syncs must keep a stable key; confirm `work-item-sync.ts` uses deterministic string, not timestamps, across channels | `lib/agent/work-item-sync.ts` | fix: assert deterministicKey is derived from explicit fields (e.g., `conversationId:taskTitle`)

### #62 feat: Phase 4 v4.0.0 — Automations & Integrations
- **Author:** Shivansh Goel | **Merged:** 2026-06-18
- **Intent:** Automations, integrations, settings UI, DB models.
- **Reality:** Added 5 Prisma migrations: `AgentRule`, `Snippet`, `SchedulingSession`, `AutomationRun`, `WorkflowTemplate/Run`, `GoogleDriveCredential`. New API routes and settings panels. `conversationUpdateForWorkflowStatus` resets/routes `userState`; `deriveWorkflowStatus()` decides from `status + userState + attentionCategory + emailType + draftStatus`.
- **Rating:** Minor gaps
- **Findings:**
  - [P0] Schema drift risk: `app/components/AppListColumn.tsx` now references `InboxTask` fields (e.g., `taskId`) in `BillSignal`, but no migration adds them to `InboxTask`; if this is a runtime join by FK, verify `InboxTask` actually stores `taskId` or title for Bills targets | `app/components/AppListColumn.tsx` | fix: audit `InboxTask` usage or add `taskId` column if the component expects it
  - [P1] README `## Connectors` section omits Outlook setup entirely; Outlook is now shipped and should have its own block | `README.md` | fix: add Outlook section mirroring `CURRENT_STATE.md`’s Outlook subsection
  - [P2] `autopilot` actions can update conversation attention; no explicit audit-log verification in `executeAutomationStep` | `lib/agent/automation-runner.ts` | fix: add summary audit log line after successful automation steps
  - [P2] `WorkflowRunner` cron-driven runs still unverified in production README; no alerting guidance or X- header | `README.md`, `app/api/cron/workflow-runner/route.ts` | fix: add cron monitoring/misfire behavior to README

## Direct Commits to main
Recent direct commits in the last 7 days (after PRs merged) are all from the repo owner and are docs/UX polish:
- `docs: update CURRENT_STATE` / design spec / implementation plan / UX polish docs
- `fix: email workflow state transitions`
- `fix: remove dead STATUS_STYLE/STATUS_LABEL vars and unused isFyi destructuring to fix ESLint build errors`
- Various targeted UX fixes on dashboard and Handle First cards

No suspicious remote pushes; commit messages follow conventional style.

## Issues Summary
| Severity | Count | Description |
|----------|-------|-------------|
| P0 | 1 | Possible schema/contract mismatch in Bills dismiss behavior |
| P1 | 3 | Missing README Outlook docs, webhook response contract, deterministicKey stability |
| P2 | 4 | Error telemetry gaps, contact-key collision, automation audit logging, cron observability |
| P3 | 2 | Landing asset policy, remote-image UX follow-up |

## Recommendations
- Close the Outlook section in `README.md` so operators know setup requirements.
- Validate Bills/Deadlines dismiss wiring against the actual `InboxTask` schema; if `taskId` doesn’t exist, either add it via migration or stop referencing it.
- Add response contracts and minimal smoke tests for health-sensitive routes (Outlook webhook 202, cron `X-Outlook-Sync-Errors`).
