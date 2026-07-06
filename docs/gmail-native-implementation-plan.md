# Gmail-Native Implementation Plan

> Companion to [`product-direction.md`](./product-direction.md). That doc sets the
> "why" and the target positioning ("Gmail-native AI email operator with the
> dashboard as the control room"). This doc is the practical "how": what to learn
> from the reference projects, what to copy vs. avoid, a phased roadmap, a
> P0/P1/P2 task breakdown, the code areas that change, and where to start.

## 0. Where FlowDesk actually is today (ground truth)

Before planning, an honest read of the current codebase so we build on what
exists instead of re-specifying it:

**Already real:**

- Canonical label vocabulary and state→label mapping —
  `FLOWDESK_GMAIL_LABEL_NAMES` and `flowDeskLabelsForConversationState` in
  [`lib/gmail-labels.ts`](../lib/gmail-labels.ts).
- Label application to Gmail — `applyFlowDeskLabelsToGmailThread` in
  [`lib/google.ts`](../lib/google.ts).
- Retry-safe writeback queue — `GmailWritebackQueue` model + the
  `gmail-writeback` cron, which currently handles `apply_labels` and `mark_read`
  actions ([`app/api/cron/gmail-writeback/route.ts`](../app/api/cron/gmail-writeback/route.ts)).
- Sync (full + incremental via history API), push/watch, reconcile crons.
- An automation substrate: `evaluateAutonomy` ([`lib/agent/autonomy.ts`](../lib/agent/autonomy.ts)),
  `checkPolicy` ([`lib/agent/policy.ts`](../lib/agent/policy.ts)),
  `AutopilotSetting`, `LearnedReplyProfile`, per-tenant confidence thresholds,
  daily send caps, and failure-based auto-disable.
- A generic `AuditLog` table + an undo route (`app/api/audit/[id]/undo`) and
  automation-run rollback (`app/api/automation-runs/[id]/rollback`).

**Gaps between the vision and the code (these are what this plan attacks):**

> **Status:** Phase A (gaps #1, #4) is shipped on `feat/gmail-native-labels`;
> Phase B (gap #2) on `feat/gmail-native-drafts`. Gaps #3, #5, #6 remain
> post-MVP.

1. ~~**Label bootstrap is not wired.**~~ **DONE (Phase A).**
   `ensureFlowDeskLabels` is now called on Gmail connect (OAuth callback) and
   backfilled on manual sync. Projection after classification is also wired via
   `projectFlowDeskLabelsForConversation` in `work-item-sync`.
2. **No Gmail-native drafts.** There is no `users.drafts.create` call anywhere.
   The `Draft` model is internal-only and `sendGmailReply` sends immediately.
   Milestone 2 ("drafts waiting in Gmail") — **addressed in Phase B**.
3. **Automation is binary, not a ladder.** The doc's Level 0–5 model does not
   exist as a first-class user-facing control; today it's `enabled` + a
   confidence threshold. *(post-MVP)*
4. ~~**Labels are hardcoded.**~~ **PARTIAL (Phase A).** A `GmailLabelMapping`
   table + settings panel now let users **hide** labels; in-Gmail **renaming**
   is deferred (needs safe reconciliation of already-created labels).
5. **Waiting-on/follow-up** exists in internal workflow status but isn't fully
   projected as a self-healing Gmail label lifecycle. *(post-MVP, Phase C)*
6. **Dashboard still reads as an inbox replacement**, not a control room.
   *(post-MVP, Phase D)*

---

## 0.5 MVP thesis: two hero features, done extremely well

The sharpened product direction: **users never have to leave Gmail.** They keep
using Gmail's website exactly as they do today and get FlowDesk's value inside
it. The FlowDesk web app becomes an *optional* dashboard/control room — useful
if you want to configure, review, or supervise, but never required for daily use.

For MVP, resist breadth. Ship a **small number of features done really well**
rather than a wide, shallow feature list. The two hero features:

1. **Auto-labeling (full-inbox categorization).** Every email in the user's
   Gmail is automatically sorted into a small, human-friendly set of FlowDesk
   labels — so when they open Gmail, the inbox is already organized. This is the
   "SaneBox quietly works in the background" + "inbox-zero labels everything
   automatically" promise, delivered natively in Gmail.
2. **Auto-drafting.** For emails that need a reply, a draft written in the user's
   voice is waiting in Gmail (native `users.drafts.create`), ready to review and
   send. This is the "Reply Zero pre-drafts every reply" + Fyxer "drafts in your
   inbox" promise.

Everything else in this plan (waiting-on tracking, rules engine, bulk
unsubscribe, analytics, add-on/extension) is **post-MVP**. It stays in the
roadmap so we build the two hero features on foundations that extend cleanly —
but it is explicitly *not* MVP scope.

**Superhuman lessons that apply even though we are not a client:** speed and
forgiveness. Whatever FlowDesk does must be fast (labels/drafts appear quickly
after mail arrives) and every automated action must be trivially reversible
(one-click undo, visible history). Trust is the whole game when you're silently
acting inside someone's real inbox.

**The MVP bar ("done really well") means:**
- Labeling is *accurate and stable* — no thrash, no relabeling churn, clean
  human-friendly names, and a sane default taxonomy that works out of the box.
- Drafts are *high quality and in the user's voice*, deduped, and suppressed the
  moment the user replies manually.
- Everything is *reversible and audited*; nothing destructive by default.
- It *just works after connecting Gmail* — zero dashboard time required.

### Reference deep-dive findings (verified, Jul 2026)

Concrete mechanics pulled from the sources, to copy directly:

**inbox-zero — rules = conditions + actions ([docs][iz-assistant]).**
- **Conditions** are either **AI-based** (a natural-language instruction the LLM
  matches per email) or **static** (`From` / `To` / `Subject` match). Static is
  explicitly preferred because it *"doesn't require AI processing on every email,
  leading to greater efficiency and reliability."* → **FlowDesk should adopt this
  static-first / AI-fallback split** so we don't burn a model call on every
  message; cheap deterministic rules first, LLM only for the ambiguous remainder.
- **Action vocabulary:** Archive, Label, Reply, Forward, Send Email, Draft Email,
  Mark Read, Mark Spam, Move to Folder, Call Webhook, Delayed Actions. AI content
  is templated inline with `{{double braces}}`. → This is essentially the
  superset FlowDesk's `GmailWritebackQueue` should grow toward; MVP needs just
  **Label** and **Draft Email**.
- **Test/dry-run:** a "Test" button shows how a new rule *would have* applied to
  recent emails before enabling it. → Adopt as the core trust feature for any
  automation.
- **Learned behavior:** *"Our AI automatically learns your behavior over time —
  no setup required,"* viewable/editable. Maps to FlowDesk's
  `preference-learning.ts` / `ClassificationCorrection`.
- **One-rule selection:** with multi-select off, the AI picks a single matching
  rule (a couple of automatic behaviors can still add a second label). → Keep
  label assignment mostly single-primary-category to avoid label soup.

**inbox-zero — Reply Zero ([docs][iz-reply]).** Two labels: `To Reply` (incoming
needs response) and `Awaiting Reply` (you sent something expecting a reply →
added to a "Waiting" list). A `Nudge` button one-click-drafts a follow-up (not
fully automatic). Must be manually enabled; Gmail users get a dedicated view. →
Validates FlowDesk's `Needs Reply` / `Waiting On` labels and the post-MVP
follow-up loop; note it's opt-in, not on by default.

**paabloLC/gmail-ai-draft — drafting mechanics.** Gmail **Watch API + Pub/Sub**
triggers processing the instant mail arrives (not cron); an AI **intent
classification** decides which emails warrant a draft; drafts are written into
Gmail's **native draft folder**; stack is Next.js/TS/Prisma/OpenAI. → FlowDesk
already runs Gmail watch/push (`gmail-watch`, `gmail/push`), so the draft path
should hang off the existing push pipeline, gated by a "should we draft?" intent
+ confidence check, exactly as this project does.

[iz-assistant]: https://docs.getinboxzero.com/essentials/email-ai-personal-assistant
[iz-reply]: https://docs.getinboxzero.com/essentials/reply-zero

---

## 1. Key lessons from each reference

### Primary repos

**elie222/inbox-zero** — the most important reference. (Full mechanics verified
above in §0.5.)
- **Rules = conditions + actions**, with a deliberate **static-vs-AI condition
  split** for efficiency, an inline `{{double-brace}}` templating system for
  AI-generated action content, and a **Test button** that dry-runs a rule against
  recent mail before it goes live.
- **Labels everything automatically** into a small named taxonomy (To Reply,
  Newsletter, Marketing, Calendar, Notification, Cold Email, Team, Urgent) —
  directly the model for FlowDesk's MVP hero feature #1.
- **Reply Zero**: `To Reply` / `Awaiting Reply` labels + a "Waiting" list and a
  one-click `Nudge` follow-up draft. Opt-in, surfaced as Gmail labels/views.
- **Behavior learning** over time with no setup, user-inspectable.
- **Cold-email blocker** and **bulk unsubscribe/analytics** as demonstrable value
  props (post-MVP for FlowDesk).
- Stack overlaps FlowDesk almost exactly (Next.js, Prisma, shadcn/ui, Turborepo,
  Upstash), so patterns port cleanly.

**IAmTomShaw/email-inbox-agent** — a lean agent loop: fetch → classify →
decide → act, with tool-call-style actions. Lesson: keep the per-message agent
step small, deterministic, and observable; don't over-orchestrate.

**cloudflare/agentic-inbox** — durable/queue-driven execution of inbox actions
(the Cloudflare Agents/Workflows angle). Lesson: model each Gmail mutation as a
durable, idempotent, retryable job — which validates FlowDesk's existing
`GmailWritebackQueue` direction and argues for extending it to *all* mutations.

### Additional open-source references

- **mail-0/zero** — self-hosting + provider-agnostic email; good reference for
  keeping the Gmail integration behind a clean boundary if Outlook/others follow.
- **paabloLC/gmail-ai-draft** — the minimal "generate a draft straight into
  Gmail" flow. Directly relevant to the missing `users.drafts.create` path.
- **muqadasejaz/n8n-Smart-Email-Assistant** & n8n Gmail/OpenAI templates —
  labeling + draft workflows expressed as simple graphs; good mental model for
  the rule → action pipeline and for what "safe defaults" look like.
- **ericrosenberg1/ai-email-assistant** — indexes your **sent** mail to imitate
  your voice; validates FlowDesk's `LearnedReplyProfile` / sent-sample approach.
- **auroracapital/ai-gmail-assistant** — categorize + star/priority + draft;
  simple label taxonomy lessons.
- **darinkishore/Inbox-MCP** — email as an **MCP server** (via Nylas). Strategic
  lesson: FlowDesk's action layer should be clean enough to later expose as an
  MCP/tool surface for user-owned agents.
- **ankitvgupta/exo** — AI-first desktop client; UX patterns for AI-native
  triage, but it *is* a client (the adoption-friction trap we're avoiding).

### Product/UX inspiration

- **Superhuman** — speed + keyboard-driven flow, "Split Inbox," instant undo.
  Lesson: whatever we surface must be fast and forgiving; every action needs a
  visible undo.
- **Fyxer** — "works where you already work"; drafts + triage appear in the
  user's own inbox with no client switch. This is FlowDesk's north star for
  *placement*.
- **SaneBox** — quiet, reliable background sorting (SaneLater/SaneBlackHole)
  that people pay for precisely because it's invisible. Lesson: reliability and
  reversibility beat flashy UI; a digest email is enough surface for many users.
- **Shortwave** — AI-native Gmail (threads, AI search, assistant). Great feature
  ideas, but a full client. Borrow the assistant/ask-about-thread UX, not the
  client.
- **Gmail / Gemini** — generic "summarize/draft this" is becoming table stakes
  and free. FlowDesk must be *more personalized, more rule-driven, more
  operational, and more transparent* than in-Gmail Gemini.

---

## 2. What FlowDesk should copy / adapt

1. **Reply-Zero-style waiting-on tracking as first-class labels** (from
   inbox-zero). FlowDesk already has the internal status; project it as a
   self-healing `Waiting On` → `Follow Up` label lifecycle.
2. **Natural-language rules with a dry-run/preview** (inbox-zero). FlowDesk has
   `rule-compiler.ts` and `AgentRule`/`SenderRule` — extend to a "planned vs.
   applied" preview before any rule mutates Gmail.
3. **Gmail-native drafts via `users.drafts.create`** (gmail-ai-draft, Fyxer):
   the single highest-leverage missing capability. A draft the user sees in
   Gmail is worth more than a draft in our dashboard.
4. **Durable, idempotent action queue for every mutation** (agentic-inbox):
   generalize `GmailWritebackQueue` beyond `apply_labels`/`mark_read`.
5. **Explicit trust ladder (Level 0–5)** as a user-facing control mapped onto
   the existing `autonomy`/`policy`/`autopilot` primitives.
6. **Voice cloning from sent mail** (ericrosenberg / already partly built):
   deepen `LearnedReplyProfile` and gate autonomy on profile quality.
7. **Quiet digest + reliability framing** (SaneBox): a daily brief email so the
   dashboard is optional for casual users.
8. **Universal undo** (Superhuman): every automated action reversible from both
   Gmail (label removal) and the dashboard audit log.

## 3. What FlowDesk should avoid

1. **Do not rebuild a Gmail client.** No full thread/compose UI aspirations
   (the exo / Shortwave trap). The dashboard is a control room, not an inbox.
2. **Do not depend on a browser extension / DOM scraping for core data or
   actions.** Gmail API is the source of truth (already the doc's principle).
   Extension comes last and only calls the backend.
3. **Do not auto-send by default.** Keep default at Level 2–3. Auto-send only
   for tightly-scoped, user-approved categories.
4. **Do not expose internal state as labels** (`triage_pending`,
   `classification_v2`). Keep labels human-friendly — the code already enforces
   a clean `FlowDesk/*` vocabulary; keep it that way.
5. **Avoid destructive-by-default actions.** Prefer archive over trash; prefer
   "mark read" over delete; everything reversible with a retained undo window.
6. **Don't let drafts pile up or duplicate.** Dedup aggressively and detect a
   manual user reply before creating/keeping a draft.
7. **Don't ship irreversible automations without an audit event.** Every mutation
   → one `AuditLog` row, no exceptions.
8. **Resist premature Outlook/multi-provider expansion** until Gmail-native PMF;
   keep the provider boundary clean but don't fan out early.

---

## 4. Phased roadmap

The phases map onto the product doc's milestones but are re-sequenced around the
real gaps. Each phase ends with a demonstrable "open Gmail and see it" outcome.

> **MVP = Phase A + Phase B only** (the two hero features: auto-labeling and
> auto-drafting). Ship those to a "done really well" bar, with the dashboard
> strictly optional, before starting C. Phases C–E are the post-MVP extension
> path and are intentionally deferred.

**Phase A — Make labels real end-to-end (finish Milestone 1).**
Wire `ensureFlowDeskLabels` into connect; auto-project labels after every
classification/state change; add the `gmail_label_mappings` table so labels are
renameable/hideable; add a settings page; ensure stale-label cleanup and audit
events for every change. *Outcome: a user connects Gmail and, without touching
the dashboard, sees FlowDesk organizing their inbox.*

**Phase B — Gmail-native drafts (Milestone 2).**
Add a `create_draft` writeback action calling `users.drafts.create`; apply
`Autodrafted`; dedup by thread + track the created `draftId`; detect manual
replies and withdraw stale drafts; preview/approve/edit from the dashboard.
*Outcome: high-quality drafts wait in the user's Gmail for important threads.*

**Phase C — Waiting-on & follow-up lifecycle (Milestone 3).**
Detect outbound-awaiting-reply; label `Waiting On`; remove on inbound reply
(via the history sync we already run); add `Follow Up` after a configurable
delay; dashboard "people you're waiting on" card. *Outcome: users stop dropping
follow-ups.*

**Phase D — Control-room dashboard + trust ladder (Milestone 4).**
Reframe UI language; ship the Level 0–5 automation selector wired to
autonomy/policy; approval queue; audit-log viewer; daily brief; training center.
*Outcome: the dashboard feels like supervising an employee.*

**Phase E — In-Gmail surface (Milestone 5).**
Decision gate → Gmail Workspace **add-on** first (trust, marketplace,
cross-platform) with contextual panel + quick actions calling the backend; then
optionally a Chrome side-panel extension for power users. *Outcome: lightweight
official controls inside Gmail.*

Phases A–C are backend-heavy and largely parallelizable after A. D depends on
A–C existing. E is explicitly gated on A–C validating the API-first model.

---

## 5. P0 / P1 / P2 task breakdown

### P0 — foundational, unblocks the positioning (Phases A–B core)

- **Wire label bootstrap.** Call `ensureFlowDeskLabels(channelId)` from the
  Gmail connect callback and as an idempotent job; backfill for already-connected
  channels. *(gap #1)*
- **Auto-project labels after classification.** After `classify` / state changes,
  enqueue an `apply_labels` writeback via `flowDeskLabelsForConversationState`.
  Today projection only fires on manual workflow/status changes.
- **`gmail_label_mappings` table + migration.** Per-tenant configurable
  name/visibility/enabled for each canonical label; label code reads mappings.
- **Gmail-native draft creation (`create_draft` writeback action).** New action
  in the writeback queue → `users.drafts.create`; store returned `draftId` on
  `Draft.metadataJson`; apply `Autodrafted`.
- **Draft dedup + manual-reply detection.** Before create: skip if a live draft
  or a user reply exists on the thread; withdraw/refresh stale drafts on new
  inbound.
- **Audit coverage for all new mutations.** Every label/draft/read/archive
  writeback writes exactly one `AuditLog` row (action + payload + undo hint).

### P1 — trust, control, and the follow-up loop (Phases C–D)

- **Waiting-on/follow-up label lifecycle**, self-healing on inbound reply +
  delayed `Follow Up` (extend `follow-up.ts` + follow-up cron).
- **Automation Level 0–5 model.** A per-tenant enum mapped onto
  `evaluateAutonomy`/`checkPolicy` gates; migrate `AutopilotSetting` to express
  it; default new users to Level 2–3.
- **Control-room dashboard reframe.** Copy/IA changes: "agent control room,"
  daily brief, agent activity feed, approval queue, automation-level selector,
  label-config UI, audit-log viewer.
- **Rule preview/dry-run.** Extend `rule-compiler.ts` so `AgentRule`s show
  planned actions on a sample before enabling.
- **Per-action confidence thresholds + "do not draft" categories** (extend
  `policy.ts` / `autonomy.ts` and `categoryThresholdsJson`).
- **Generalize `GmailWritebackQueue`** to cover archive/trash/star and future
  actions with one idempotent, retryable executor.

### P2 — depth, distribution, differentiation (Phase E + polish)

- **Gmail Workspace add-on** (contextual card, label reason, quick actions:
  Mark handled / Follow up later / Draft reply / Teach FlowDesk) — server-side
  mutations only.
- **Chrome side-panel extension** for power users (calls backend; no DOM
  scraping for data).
- **Bulk unsubscribe/clean-inbox analytics** surfaced as a value dashboard
  (partly exists under `app/clean-inbox`).
- **Cold-email / low-value auto-triage policies** (Level 4 categories).
- **MCP/tool surface** exposing FlowDesk actions to user-owned agents
  (Inbox-MCP-style), once the action layer is clean.
- **Dedicated audit/analytics store** if `AuditLog` volume warrants it.
- **Outlook parity** behind the existing provider boundary — only post-PMF.

---

## 6. Codebase areas that likely need changes

**Gmail integration / actions**
- [`lib/google.ts`](../lib/google.ts) — call site for `ensureFlowDeskLabels`;
  add `createGmailDraft`, `withdrawGmailDraft`; extend archive/trash coverage.
- [`lib/gmail-labels.ts`](../lib/gmail-labels.ts) — read from
  `gmail_label_mappings`; add draft/waiting/follow-up projection cases.
- [`lib/gmail-sync.ts`](../lib/gmail-sync.ts) — hook incremental sync to remove
  `Waiting On` and withdraw stale drafts on inbound reply.

**Action queue / crons**
- [`app/api/cron/gmail-writeback/route.ts`](../app/api/cron/gmail-writeback/route.ts)
  — add `create_draft`, `withdraw_draft`, `archive`, `remove_labels` actions.
- [`app/api/cron/follow-up/route.ts`](../app/api/cron/follow-up/route.ts) &
  [`lib/agent/follow-up.ts`](../lib/agent/follow-up.ts) — waiting-on/follow-up
  lifecycle.
- [`app/api/connectors/gmail/callback/route.ts`](../app/api/connectors/gmail/callback/route.ts)
  — bootstrap labels on connect.

**Agent / classification / policy**
- [`lib/agent/classify.ts`](../lib/agent/classify.ts),
  [`lib/agent/workflow-runner.ts`](../lib/agent/workflow-runner.ts),
  [`lib/agent/work-item-sync.ts`](../lib/agent/work-item-sync.ts) — enqueue label
  projection after every state change.
- [`lib/agent/policy.ts`](../lib/agent/policy.ts) &
  [`lib/agent/autonomy.ts`](../lib/agent/autonomy.ts) — per-action thresholds,
  "do not draft" categories, Level 0–5 mapping.
- [`lib/agent/autopilot.ts`](../lib/agent/autopilot.ts) — draft-create eligibility
  vs. auto-send eligibility split.
- [`lib/agent/rule-compiler.ts`](../lib/agent/rule-compiler.ts) — dry-run/preview.

**Drafting**
- Draft API routes under `app/api/conversations/[id]/draft/*` and
  [`lib/ai/prompts/draft-reply.ts`](../lib/ai/prompts/draft-reply.ts) — route the
  approved/generated draft into Gmail rather than only internal storage.

**Schema / migrations**
- [`prisma/schema.prisma`](../prisma/schema.prisma) — new `GmailLabelMapping`
  model; `Draft.metadataJson` gains `gmailDraftId`; `AutopilotSetting` (or a new
  `AutomationSetting`) gains an explicit level.

**Dashboard (frontend)**
- `app/settings/*` — new Gmail-native label config page; automation-level
  selector (extend `AutopilotSettingsForm.tsx`).
- `app/audit/page.tsx` — audit-log viewer as control-room surface.
- `app/approvals/*` — approval-queue polish for draft review.
- `app/digest/*` — daily brief; global copy/IA reframe to "control room."

---

## 7. Recommended first implementation steps

Do these in order; each is a small, shippable PR (own worktree + branch per
repo convention), and together they finish Milestone 1 and open Milestone 2.

1. **Wire `ensureFlowDeskLabels` into connect** and add an idempotent backfill
   for existing channels. Smallest possible change that makes labels appear at
   all. Verify: connect a test account → labels exist in Gmail. Add the audit
   event.
2. **Auto-project labels after classification.** In the classify/state-write
   path, enqueue `apply_labels` from `flowDeskLabelsForConversationState`. Verify
   with an integration test that a newly-classified thread gets the right
   `GmailWritebackQueue` row and, after cron, the right Gmail labels.
3. **Add `GmailLabelMapping` (migration + model)** and make `gmail-labels.ts`
   read it, with the current hardcoded names as defaults. Ship a minimal settings
   page to rename/hide. (Backend + a thin UI.)
4. **Add the `create_draft` writeback action** (`users.drafts.create` in
   `lib/google.ts`, new case in the writeback cron) with dedup + manual-reply
   detection, applying `Autodrafted`. This is the first Milestone-2 slice and the
   biggest perceived-value jump.
5. **Prototype the Level 0–5 selector** mapped onto existing autonomy/policy
   gates, defaulting to Level 2, so steps 1–4 are governed by an explicit,
   user-visible trust setting from day one.

**Guardrails for every step (repo conventions):**
- New git worktree per task: `git worktree add .worktrees/<branch> -b <branch> origin/main`.
- Tests are Vitest (`npx vitest run`); there's a strong existing Gmail test
  suite (`gmail-*.test.ts`) — extend it, especially tenant-isolation and
  writeback-idempotency cases.
- Required before any PR: `npm test`, `npx tsc --noEmit`, `npm run lint`.
- Every Gmail mutation must be idempotent, reversible, and audited.
- Update the living docs affected (per `docs/README.md`); no handoff files.

---

## Open questions to resolve before Phase D

Carried from the product doc; these gate the trust/UX design:

- Target first: individuals, SMBs, or shared/team inboxes? (Changes label
  taxonomy and audit granularity.)
- Default automation level for new users (recommend Level 2, opt-in to 3).
- Minimum audit surface for users to feel safe (probably: per-action row +
  one-click undo + a daily "here's what I did" brief).
- Add-on vs. extension first for Phase E (recommend add-on for trust/marketplace).
- Permissions framing at OAuth consent to maximize trust (least-scope, staged).
