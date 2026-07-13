# Storage & capacity

Living runbook for database storage: what grows, what bounds it, how to read the
numbers, and how far the current setup scales. Written after the 2026-07-12 volume-full
outage and the 2026-07-13 storage audit + remediation (PRs #163, #164). Update this
when retention windows, the storage architecture, or the measured constants change.

## Topology

Prod runs on Railway (Hobby plan): one `next start` process (service **flowdeskinbox**,
auto-deploys from `main`) and one Postgres 17 service with volume **postgres-volume-oJiP**
mounted at `/var/lib/postgresql/data`, sized **5GB** (grown from 500MB after the outage).
Background jobs run in-process (`lib/scheduler/`); there is no external cron, no replica,
no horizontal scaling — capacity growth is vertical (bigger volume, then Pro plan).

Railway limits that matter: Hobby volumes cap at 5GB; Pro starts at 50GB (self-serve to
1TB). Volumes can grow live but never shrink. Billing is per GB actually used
(~$0.15–0.25/GB-month), so a mostly-empty 5GB volume costs almost nothing.

## How to read the volume numbers

Three different numbers exist and they disagree by design:

1. **Live DB size** (`SELECT pg_size_pretty(pg_database_size('railway'))`) — the real
   data. ~50MB as of 2026-07-13.
2. **Filesystem usage** inside the container (`df`) — live DB **plus the WAL journal**.
   WAL is capped by `max_wal_size=1GB`, recycles lazily, and never returns to zero;
   ~300MB of WAL+catalogs is a permanent floor unrelated to data volume.
3. **Railway's volume graph** — measured at the storage layer *beneath* the filesystem.
   Blocks freed by deletes/VACUUM release lazily, so the graph reads high after a purge
   and drifts down slowly. The lag is cosmetic: freed blocks are reused before new ones
   are allocated. **The healthy signal is a flat trend, not the absolute number.**

So a volume graph reading of ~600MB while the live DB is 50MB is normal, not a leak.

## What grows, and what bounds it

### Product data (grows with users/mail — this is the real cost)

Message bodies dominate. Gmail sync stores full HTML with inline images embedded as
base64 data URIs (capped 512KB/image, 2MB/message — `lib/google.ts`); Outlook stores
plain text. Measured constants (2026-07-13, 7 mailboxes, 500 messages):

- ~14KB per message stored (row + indexes), avg body 25KB, max 229KB
- ~1.5–2MB per mailbox at onboarding (initial sync caps at 25–50 threads)
- ~5–15MB per active user per year of accumulation

Attachments are metadata-only (no blobs in Postgres).

### Operational data (grows with *activity* — bounded since 2026-07-13)

This class of data — not mail — is what filled the volume in the outage (AuditLog alone
hit 262MB during the echo loop). Two layers now bound it:

**Retention** (`lib/agent/data-retention.ts`, `data-retention` scheduler job, daily +
on boot; manual trigger `POST /api/cron/data-retention` with `CRON_SECRET`):

| Table | Window | Why this window |
|---|---|---|
| AuditLog | 30 days | debugging receipts only; nothing reads old rows |
| AiUsageEvent | 90 days | **must exceed a full calendar month** — `lib/ai/budget.ts` aggregates the current month for daily/monthly AI spend limits |
| GmailPushEvent | 30 days | processed push receipts; sync cursor is long past them |
| OutlookSyncEvent | 30 days | same, for Graph notifications |

**Write gating** (PR #164) — no-op receipts are not written at all: no AiUsageEvent for
skipped LLM calls (`person_memory.cache_hit` / `too_few_messages` / `policy_skipped`),
no `conversation_state.synced` / `person_memory.synced` audit row unless the row
actually changed, and Outlook deltas update only `isRead` on messages we already have
instead of rewriting the full row (body included). This removed ~80% of the
steady-state write rate (verified live: a push → sync → classify pass now writes zero
bookkeeping rows when nothing changed).

### Do NOT prune these

- **EmailWritebackQueue** — looks append-only but is upserted on
  `@@unique([conversationId, action])`, so it is bounded by conversation count. Its
  completed/acknowledged rows feed the label echo-suppression check from PR #150
  (`queueFlowDeskLabelWriteback`); deleting them re-opens the echo-loop risk.
- **AgentJob / AgentToolCall** — has live readers that fetch a conversation's *latest*
  job (draft-generation, lead-sequence, follow-up) and a non-cascading relation to
  ApprovalRequest. Pruning needs design, not a blind `deleteMany`. Small today.
- Long tail (ClassificationCorrection, AutomationRun, WorkflowRun, ApprovalRequest,
  SnoozeReminder, CalendarHold, ValueSnapshot): unbounded in principle, small in
  practice; extend the retention cron deliberately if one starts to matter.

## Capacity math ("how many users fit?")

With operational tables bounded, budget ≈ volume size − ~300MB WAL/catalog floor.
At ~10MB/user-year of mail (midpoint of measured 5–15MB):

- **5GB Hobby volume ≈ 300–500 users** with a year of accumulation
- Storage cost per user is ~2¢/month at 100MB — the plan-tier cap binds long before economics do
- Growth path: grow the volume (live, zero-downtime) → Pro plan at 50GB+

Watch items as users grow: AuditLog/AiUsageEvent *rates* (retention bounds size, but a
new hot loop would still burn API quota — the echo loop did 133k Gmail calls/day), and
Message table share of total DB size (trigger for the deferred body work below).

## Decisions deliberately deferred (2026-07-13)

- **Mail retention policy: 2 years, decided but NOT built.** When built it must be
  conversation-level (deleting individual old messages from a live thread gets undone —
  and churned — by the next thread re-fetch) with tombstones to block re-import, plus
  handling for derived rows. Build when real users exist *and* Message dominates the DB.
  Until then the policy is a `/privacy`-page statement, not code.
- **Gmail body/base64-image externalization** (store CID→attachment refs, fetch from
  Gmail at render). Biggest per-user cost lever, but makes rendering depend on a live
  provider token — dead tokens (`invalid_grant`) are a recurring failure mode and would
  break message *display*, not just sync. Revisit when Message is the dominant table.
- **Index review**: ConversationState carries 5 tenant-scoped indexes on a high-churn
  table, and `Message_searchVector_idx` showed zero scans — but pg stats reset at the
  07-12 restart, so that evidence covered ~1 day. Let stats accumulate weeks first.
- **Change-driven reconcile**: the 30-min `email-state-reconcile` / 6h
  `email-label-reconcile` full scans are the safety net for missed push notifications
  and have caught real drift. Keep them until tenant count makes the scans measurably
  expensive; even then retain a low-frequency full scan as backstop.

## Checking health

- `GET /api/admin/scheduler-status` (Bearer `CRON_SECRET`) — per-job last run/result;
  the `data-retention` entry reports per-table deleted counts.
- Live DB + top tables: `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)), n_live_tup FROM pg_stat_user_tables ORDER BY 2 DESC;`
  via `psql` on the Postgres service (Railway SSH; see the team access playbook).
- If the volume graph trends *up* while user count is flat, find the writer first
  (`GROUP BY action` / `GROUP BY feature` on the receipt tables) — the 07-12 outage
  pattern was a feedback loop writing receipts, not data growth.
