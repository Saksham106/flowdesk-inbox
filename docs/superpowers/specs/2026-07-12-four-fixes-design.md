# Design: sent-email formatting, native-draft parity, app theming, analytics redesign

Date: 2026-07-12
Status: approved for implementation (4 independent workstreams, one PR each)

## Context

Four unrelated issues raised in one session. Each is root-caused against current
`origin/main` (verified after fast-forwarding a stale local checkout that was 60
commits behind). Each ships as its own worktree branch + PR per repo convention.

---

## 1. Sent emails get random line breaks in Gmail

**Root cause:** [lib/google.ts:597](../../lib/google.ts#L597) `buildReplyMimeRaw`
places the message body verbatim into the `text/plain` MIME part. AI-drafted
replies come back from the model with hard line-wraps (literal `\n` roughly
every 70-80 characters — the model's habit of writing "email-style" plaintext
with a fixed column width). Gmail renders every one of those embedded newlines
as a real line break, so a sentence visibly splits mid-way and continues on
the next line.

`lib/agent/draft-sanitizer.ts` already normalizes AI output (strips quoted
threads, collapses 3+ blank lines, strips AI preambles) but does not touch
single hard-wrap newlines.

**Fix:** add a `unwrapHardWrappedText` step to `sanitizeDraftText` (or a
sibling function called right after it in `draft-generation.ts`) that:
- Splits on `\n`.
- Joins consecutive non-empty lines with a space (undoing the hard wrap).
- Preserves blank lines (`\n\n`) as paragraph breaks.
- Leaves list-like lines alone (lines starting with `-`, `*`, digit+`.`) so
  bullet lists don't get flattened into prose.

Apply it to AI-drafted text before it's stored/sent. Do NOT apply it in
`buildReplyMimeRaw` itself — that function is also used for manually-typed
replies (via `sendConversationMessage` → `sendGmailReply`), where a user's own
line breaks must be preserved exactly as typed.

**Testing:** unit tests in `tests/draft-sanitizer.test.ts` (or new
`tests/draft-unwrap.test.ts`) covering: hard-wrapped paragraph collapses to
one line joined by spaces; blank-line paragraph breaks survive; a markdown-ish
bullet list is not mangled; text with only natural (non-wrapped) newlines is
unchanged.

---

## 2. Native Gmail drafts don't appear for one account

**Not a settings/persistence bug** — `getAutomationLevel` reads
`AutopilotSetting.automationLevel` directly with no cache, and the PATCH
handler persists it correctly in both `create` and `update` branches of the
upsert. Automation Level 3+ is required for `create_gmail_drafts`
([lib/agent/automation-level.ts](../../lib/agent/automation-level.ts)), and
a backfill mechanism already exists precisely to re-propose drafts after a
tenant crosses the Level-3 threshold ([AutopilotSettingsForm.tsx](../../app/settings/AutopilotSettingsForm.tsx),
[backfill-drafts/route.ts](../../app/api/autopilot-settings/backfill-drafts/route.ts)).

**Root cause:** [app/api/autopilot-settings/backfill-drafts/route.ts:34](../../app/api/autopilot-settings/backfill-drafts/route.ts#L34)
selects backfill-eligible conversations with:

```ts
where: { tenantId, status: "needs_reply", draft: null }
```

`draft: null` only matches conversations that never got a Draft record at
all. But the exact scenario reported — "I can see the draft on the website,
just not in Gmail" — means a Draft record **already exists** (created while
the tenant was at Level < 3, so `queueGmailDraftWriteback` no-op'd and no
`gmailDraftId` was ever set in its metadata). The current query silently
excludes exactly these conversations from backfill, so raising the level and
running backfill does nothing for them.

`proposeDraftForConversation` ([lib/agent/draft-generation.ts:330](../../lib/agent/draft-generation.ts#L330))
is idempotent (upsert keyed on conversationId) and unconditionally calls
`queueGmailDraftWriteback` at the end, re-checking the current automation
level itself — so it's safe to call again for a conversation that already has
a dashboard-only draft.

**Fix:** change the backfill eligibility query to include conversations whose
existing draft has no `gmailDraftId` in its metadata yet, not just
conversations with no draft:

```ts
const candidates = await prisma.conversation.findMany({
  where: { tenantId, status: "needs_reply" },
  orderBy: { lastMessageAt: "desc" },
  include: { draft: true },
})
const eligible = candidates
  .filter((c) => !c.draft || gmailDraftIdFromMetadata(c.draft.metadataJson) === null)
  .slice(0, take)
```

(reusing `gmailDraftIdFromMetadata` already exported from
`lib/gmail-drafts.ts`). Keep the existing `HARD_CAP` behavior and the
`scope: "last_n"` `n` param — just widen the base `where` and do the
gmailDraftId filter in application code, since portable "JSON field missing
key" filtering isn't reliable across Prisma providers.

**Testing:** update `tests/backfill-drafts-route.test.ts` to add a case:
conversation has an existing Draft with `metadataJson` lacking `gmailDraftId`
→ it is included in backfill eligibility and `proposeDraftForConversation` is
called for it. Keep the existing "no draft at all" case passing.

---

## 3. App theme colors, favicon, and rail logo

**Favicon is already fixed** — `app/icon.svg` and
`public/images/landing/logo-icon.svg` already carry the lighthouse mark
(shipped in PR #138, already on `origin/main`). No favicon work needed; if it
still shows a Vercel icon in a browser, that's a stale local build/cache, not
a missing asset.

**Real gap found:** the app interior (sidebar rail, buttons, focus rings,
links — ~41 files) still uses Tailwind's default `blue-*` palette, while the
landing page uses a neutral near-black/gray palette (`#404040` body text,
black CTAs, `#e0e1ec` borders, no blue anywhere). This is the "too blue,
doesn't match the landing vibe" gap.

**Fix:**
- Add semantic accent tokens to `app/globals.css` (in the existing `:root` /
  `@theme inline` blocks) mirroring the landing palette — e.g.
  `--color-accent: #18181b` (near-black) with a hover/active shade, rather
  than inventing a new blue.
- Sweep the ~41 non-landing files replacing brand-action `bg-blue-*`,
  `text-blue-*`, `ring-blue-*`, `border-blue-*` (buttons, active nav states,
  focus rings, links) with the new accent tokens.
- Leave semantically-colored states alone: red/amber/green for
  error/warning/success (used correctly elsewhere and unrelated to brand
  color).
- Swap the AppRail's hardcoded `focus:ring-blue-300` (the one remaining blue
  reference on the already-fixed logo link) to the new accent ring.

**Testing:** this is a visual change — verify by loading `/mail`, `/home`,
`/settings`, `/clean-inbox/analytics` in the browser before/after and
confirming no remaining default-blue brand chrome outside genuinely
informational blue (if any is intentionally kept, call it out explicitly).
No new unit tests; existing UI/contract tests must keep passing untouched
(they don't assert on color classes).

---

## 4. Cleanup Analytics page redesign

**Current state** ([app/clean-inbox/analytics/page.tsx](../../app/clean-inbox/analytics/page.tsx)):
one paragraph of inline stats, then two equal-weight flat lists (all content
types, top 20 domains) — no headline number, no trend, no color coding, no
hierarchy. Data available: `getCleanupOverview(tenantId, range)` already
computes `totalCleanable`, `unsubscribableCount`, `protectedOrSkipped`,
`byEmailType`, `topDomains` for a given date range (7/30/90 days), but there's
no historical/trend storage.

**Fix (no new data model required):**
- Compute the same overview for the immediately-preceding period of equal
  length (e.g. current 30 days vs. the prior 30 days) by calling
  `getCleanupOverview` again with a shifted range, and diff `totalCleanable`
  and `unsubscribableCount` to get a percentage/absolute delta.
- Headline section: one large "cleanable conversations" number with a small
  green (▲ improvement, i.e. fewer to clean) / red (▼ regression, i.e. more
  to clean) delta badge vs. the prior period, plus the unsubscribable count
  as a secondary stat.
- "By content type": keep, but visually de-emphasize (smaller card, lighter
  weight) relative to the headline.
- "Top domains": show top 5 by default with a "Show N more" disclosure for
  the rest (currently a flat top-20 dump) — collapsed state is the default,
  not a data dump.
- Keep `protectedOrSkipped` as a small footnote line, not a headline stat —
  it's context, not an actionable number.

**Testing:** unit test the new prior-period delta calculation (pure function,
e.g. `computeCleanupTrend(current, previous)` in `lib/cleanup-candidates.ts`
or a new small module) covering: improvement (green), regression (red), flat
(no badge), and division-by-zero-safe when the prior period had 0 cleanable
conversations.

---

## Delivery plan

Four independent worktrees/branches/PRs (no shared files between 1, 2, 4;
item 3 touches many files but none touched by 1/2/4):

1. `fix/draft-hard-wrap-normalize`
2. `fix/gmail-draft-backfill-eligibility`
3. `redesign/app-theme-accent-colors`
4. `redesign/cleanup-analytics-hierarchy`

Each gets: implementation, tests, `npm test` + `npx tsc --noEmit` + `npm run
lint` green, then its own PR. No handoff docs beyond this spec + each PR's own
description (per `docs/README.md` policy).
