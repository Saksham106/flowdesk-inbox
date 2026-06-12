# Email Risk Radar Design

Date: 2026-06-12

## Goal

Ship a dedicated `/risk-radar` view that helps a user find inbox threads where time, money, trust, or sensitivity may be at risk without introducing a new database model.

## Scope

This slice is a deterministic, read-only radar built on existing conversation, message, draft, approval, and state data. It surfaces four signal families:

- Deadline soon: inbound threads mentioning tomorrow, today, urgent, ASAP, due dates, or final dates.
- Final notice: messages mentioning final notice, last chance, collections, overdue, cancellation, shutoff, suspension, or past-due payment language.
- Unanswered: inbound `needs_reply` threads older than a configurable age, defaulting to 3 days.
- Sensitive content: high-risk draft metadata, escalation reasons, complaint labels, or legal, medical, financial, HR, tax, immigration, refund, dispute, contract, or emotional conflict terms.

## Product Behavior

The page is available from the inbox navigation as "Risk Radar" for business accounts. The view shows a compact summary band with counts by signal family, then grouped conversation lists ordered by urgency and age. Each row links to the conversation, shows the contact/thread name, the most important reason, last-message age, and a short next action.

The radar is read-only. It does not archive, send, draft, mutate conversation state, or create approval requests. It should be safe to load repeatedly and safe to run against partially synced inbox data.

## Architecture

Create `lib/agent/risk-radar.ts` as a pure analysis module. It accepts conversation-shaped inputs similar to `command-center.ts`, returns normalized `RiskRadarItem` objects, groups them into `deadlineSoon`, `finalNotices`, `unanswered`, and `sensitive`, and provides summary counts. `app/risk-radar/page.tsx` stays server-rendered: it authenticates with NextAuth, loads tenant-scoped conversations from Prisma, calls the pure helper, and renders the grouped lists.

Navigation uses `lib/app-navigation.ts`, matching existing Tasks, Leads, Reports, and Meetings links. No Prisma schema or migration is needed.

## Detection Rules

Signal matching is intentionally conservative:

- Deadline soon wins when the latest inbound text has near-term deadline language. Priority is urgent for today/tomorrow/ASAP/final-date language, high for other deadline language.
- Final notice wins when payment, service interruption, cancellation, or collections terms are present. Priority is urgent.
- Unanswered applies only when the latest message is inbound, the conversation is not closed, and the thread has waited at least 3 days.
- Sensitive applies from high-risk metadata, escalation reason, complaint label, or sensitive pattern matches. Priority is urgent if metadata is high-risk or an escalation reason exists, otherwise high.

One conversation may appear in multiple sections if multiple signals are present. The summary counts unique conversation ids for the total risk count and per-section item counts for category totals.

## Testing

Add `tests/risk-radar.test.ts` first. Cover deadline detection, final notice detection, unanswered age threshold, sensitive metadata/text detection, sorting, grouping, and unique total count behavior. Keep tests pure; no database mocks are needed for the helper.

## Documentation

When implemented, update:

- `docs/CURRENT_STATE.md`
- `docs/TODO.md`
- `docs/MASTER_PRODUCT_PLAN.md`

Do not update `README.md` unless setup, scripts, or environment variables change.
