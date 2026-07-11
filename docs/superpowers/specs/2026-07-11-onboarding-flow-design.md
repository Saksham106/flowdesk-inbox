# New-User Onboarding Flow — Design

**Date:** 2026-07-11
**Status:** Approved

## Goal

Give brand-new users a short, dedicated setup screen that walks them through the
two things FlowDesk actually needs to be useful — connecting Gmail and training
their reply style — without a long multi-page tour. Two steps, one action per
screen, always skippable.

## Current state

- Signup (`app/login/page.tsx`) auto-signs-in and drops users on `/home` with
  nothing connected.
- `/onboarding` exists but is only the post-OAuth "first pass" proof screen
  (`OnboardingFirstPass.tsx`); the Gmail OAuth callback redirects fresh
  connections to `/onboarding?connected=<email>`.
- Gmail connect: `GET /api/connectors/gmail/connect` (redirects to Google).
- Style training: `POST /api/personal-profile/train` — requires a connected
  email channel; learns tone/greetings/signoffs from sent mail and returns a
  profile summary.

## Approach

A state-derived wizard at `/onboarding`. Step completion is derived from real
data — an email `Channel` row means Gmail is connected; a `LearnedReplyProfile`
row means style is trained — so there is no schema change, no completion flag,
and the flow can never disagree with reality. No middleware gating: new signups
are routed into the flow once, and anyone can skip out to `/home` at any point.

Rejected alternatives:

- **Forced gating via `Tenant.onboardingCompletedAt` + middleware** — needs a
  migration and backfill for existing tenants, and risks trapping users if the
  flag desyncs. Overkill for a two-step flow.
- **Setup checklist widget on `/home`** — not a dedicated screen; doesn't give
  the focused one-thing-at-a-time experience requested.

## Flow

Single centered card on a full-screen `/onboarding` page, with a small step
indicator (dots + labels) for the two steps. One primary action per screen.

**Step 1 — Connect Gmail.** Short value copy plus one "Connect Gmail" button
linking to `/api/connectors/gmail/connect`. The OAuth callback already returns
to `/onboarding?connected=<email>`; when that param is present the wizard runs
the existing first-pass inline (spinner → "N emails organized" proof with label
chips and sample threads, reusing the current `OnboardingFirstPass` rendering),
then a "Continue" button advances to step 2. First-pass failure shows the
existing recovery copy but still allows continuing.

**Step 2 — Train your writing style.** One button that POSTs
`/api/personal-profile/train`, with a progress state ("Reading your sent
mail…"), then a compact summary of what was learned (tone, greetings,
signoffs). Errors show inline with retry. A "Skip for now" link advances
without training.

**Finish.** "You're all set" screen with a single "Go to your control room"
button → `/home`, plus the existing "Open Gmail to see your labels" link.

## Entry points and routing

- **Signup:** the signup branch of `app/login/page.tsx` changes its post-signin
  redirect from `/home` to `/onboarding`. The sign-in branch is unchanged.
- **Gmail OAuth callback:** unchanged — it already redirects fresh connections
  to `/onboarding?connected=<email>`, which now lands inside the wizard at the
  first-pass sub-state of step 1.
- **Direct visits:** `app/onboarding/page.tsx` computes
  `{ gmailConnected, styleTrained }` server-side and starts the wizard at the
  first incomplete step. If both are complete and there is no `connected`
  param, redirect to `/home` so returning users never see a stale wizard.

## Components

- `app/onboarding/page.tsx` — server component; auth guard (existing), queries
  `Channel` (type `email`) and `LearnedReplyProfile` for the tenant, renders
  the wizard with initial state.
- `app/onboarding/OnboardingWizard.tsx` — new client component; owns step
  state, absorbs the first-pass fetch/proof rendering from
  `OnboardingFirstPass.tsx` (which is deleted), adds the training step and
  finish screen. Tailwind, matching the existing slate/blue onboarding styling.
- `lib/onboarding.ts` — pure `resolveOnboardingStep({ gmailConnected,
  styleTrained, justConnected })` helper so step resolution is unit-testable.
- `app/login/page.tsx` — one-line redirect change in the signup branch.

## Error handling

- First-pass API failure: keep current copy ("run it again from Settings →
  Gmail behavior"), plus Continue — a labeling hiccup must not block setup.
- Training failure (e.g. AI spend limit, 502): inline error with Retry and
  Skip; skipping is always available.
- Unauthenticated: existing redirect to `/login` stays.

## Testing

- Unit tests (Vitest) for `resolveOnboardingStep` covering: nothing done →
  step 1; just connected → first-pass sub-state; connected but untrained →
  step 2; everything done → redirect/home.
- Standard pre-PR checks: `npm test`, `npx tsc --noEmit`, `npm run lint`.

## Out of scope

- No schema changes, no middleware, no forced completion tracking.
- No additional steps (VIP contacts, automation level, calendar) — the flow
  stays at two steps; everything else lives in Settings.
