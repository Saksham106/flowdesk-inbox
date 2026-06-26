# GitHub Audit — 2026-06-25
## Summary
Healthy push: five merged PRs in the last 36h cover critical resilience work (loading states, encryption rotation, Outlook delta sync, and remote-image privacy). No seats-of-pants iOS bugs, but PR #67 ships with a real fallback-path regression that will silently leave stale Outlook mailboxes un-synced in some cron runs.

## Merged PRs (past 36 hours)
### #71 fix: loading states across inbox (thread skeleton, row actions, banners)
- **Author:** Shivansh Goel | **Merged:** 2026-06-25 17:26Z
- **Intent:** Prevent double-click / ambiguous state while inbox row actions are in flight.
- **Reality:** `pendingAction` lock added across `toggleRead`, `toggleStatus`, `archiveConversation`, and `changeAttention` in `InboxRow`. Skeleton loader added in `app/conversations/[id]/loading.tsx`. `ReadLaterSection` and `PhishingWarningBanner` also get loading/error state. Tests cover resilience contract.
- **Rating:** Healthy
- **Findings:**
  - [P3] Loading lock scope is row-level only; if a user is on the thread detail page and triggers a workflow-status action, there is still a small window where a rapid double-click could cause a duplicate request unless caller-side locking is also present.

### #70 fix: close issues #64, #40, #41 — regex dedup, CID images, encryption rotation
- **Author:** Shivansh Goel | **Merged:** 2026-06-25 17:20Z
- **Intent:** Fix deduplicated FYI constants, resolve Gmail CID inline images safely, and add encryption key rotation support.
- **Reality:** Regex constants centralized in `lib/inbox-fyi.ts`, `collectInlineImages` implemented in `lib/google.ts`, size-capped CID embedding added, `decryptString` gains previous-key fallback, new `/api/admin/rekey` endpoint, tests added in `tests/crypto.test.ts` and `tests/email-body.test.ts`.
- **Rating:** Minor gaps
- **Findings:**
  - [P2] Admin rekey route is hard to operationalize without docs. Add a README/CURRENT_STATE section for key rotation procedure and env-var naming. files: README.md, docs/CURRENT_STATE.md | fix: Add operational checklist (similar to Outlook sync checks) for rekey: backup DB before migration, monitor error count, then unset `ENCRYPTION_SECRET_PREVIOUS`.

### #68 feat: redesign landing page to match Figma design
- **Author:** Mehmet Battal | **Merged:** 2026-06-24 20:33Z
- **Intent:** Full visual redesign of landing.
- **Reality:** Huge restyle of `FAQ.tsx`, `Features.tsx`, `SocialProof.tsx`, layout/page, global CSS vars, product assets added to `public/images/landing/`, OG/Twitter metadata. CURRENT_STATE doc updated.
- **Rating:** Healthy
- **Findings:**
  - [P3] Footer social/company/tools links use `href="#"`. Confirm these are populated before public launch or explicitly marked as placeholder. files: app/page.tsx | fix: Replace `#` hrefs or add `aria-hidden` / `role=none` to avoid accidental focus/hover states.

### #67 feat: durable hybrid Outlook delta sync (#42)
- **Author:** Saksham Goel | **Merged:** 2026-06-24 17:09Z
- **Intent:** Add durable paginated Outlook delta sync with webhook intake, subscription lifecycle, and bounded worker.
- **Reality:** New `lib/outlook-sync.ts`, `lib/outlook-worker.ts`, `lib/outlook-subscriptions.ts`, webhook/cron routes, upsert schema + tests. Architecture is solid.
- **Rating:** Significant gaps
- **Findings:**
  - [P1] Stale fallback is silently skipped for channels already seen in `processedChannels`. In the same cron invocation, if one channel’s event is busy, another stale mailbox paired with it will not receive its fallback sync until a future run. This reduces the 15-minute fallback guarantee in some cases. files: lib/outlook-worker.ts:125-137 | fix: Either dedupe fallback candidates against only *completed* events, or run fallback passes after event processing regardless of `processedChannels`.
  - [P2] repo roadmap docs reference a future `gmail_label_mappings` table not present in current schema. This is acceptable as plan prose, but reinforces the gap that label customization is missing. files: docs/superpowers/plans/2026-06-25-gmail-native-direction.md | fix: Clarify it is a future work or issue link.
  - [P2] Operational checklist for Outlook is in README, but there is no corresponding section in CURRENT_STATE. files: docs/CURRENT_STATE.md | fix: Mirror Outlook notes from README so the canonical state doc stays authoritative.

### #66 [codex] Block remote email images by default
- **Author:** Saksham Goel | **Merged:** 2026-06-24 05:15Z
- **Intent:** Default-deny remote images; per-message opt-in.
- **Reality:** Server produces blocked/opt-in HTML variants, iframe enforces default-deny CSP, opt-in permits only HTTPS, UI added to `EmailBodyIframe`.
- **Rating:** Healthy
- **Findings:**
  - [P3] Remote images blocked message should include a one-line disclosure that “loading images notifies senders”, per spec `2026-06-24-email-remote-image-privacy.md`. files: app/components/EmailBodyIframe.tsx | fix: Append short privacy copy below the banner.

## Direct Commits to main (past 36 hours)
### <no direct commits beyond merge commits>
All PR commits reached main via squash merges. No additional non-PR commits detected.

## Recent Commits — Light Review (36h–7d)
- squat merge PR landing noise is consistent and doc-aligned.
- Commit `91a234b` adds roadmap and product-direction alignment — healthy.
- Commit `7e78e4b` introduces Gmail-native label writeback — already covered above.
- Commits `dffb49f`, `2405dc0`, `0ff34d0`, `6c681a9`, `df2836e` are refactor/test cleanups supporting workflow status — healthy.
- No suspicious direct pushes to main outside normal PR flow.

## Issues Summary
| Severity | Count | Description |
|----------|-------|-------------|
| P0 | 0 | — |
| P1 | 1 | Outlook cron fallback-path skip (PR #67) |
| P2 | 2 | Missing user-facing docs for rekey and Outlook operational checks duplication; `gmail_label_mappings` roadmap vs schema mismatch |
| P3 | 2 | Footer hrefs placeholders; missing privacy copy in banner |

## Recommendations
- Fix the `processedChannels` stale-fallback skip in `lib/outlook-worker.ts` and add a test for a mixed busy + stale mailbox run.
- Add operational documentation for encryption rotation in README/CURRENT_STATE so #70’s rekey endpoint isn’t a secret handshake.
- Close the label-mapping gap explicitly in issue tracker so the roadmap and schema stay in sync.
