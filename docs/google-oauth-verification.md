# Google OAuth verification

Operational reference for FlowDesk's Google OAuth app verification (restricted
Gmail scopes) and the annual CASA renewal. GCP project: `flowdesk-498812`.

## Current configuration (as of 2026-07-11)

- **Domain ownership**: `flowdeskinbox.com` is verified for the project owner
  account at both the site level (meta tag in `app/layout.tsx` →
  `metadata.verification.google`) and the DNS level (TXT record
  `google-site-verification=…` at Porkbun). Both must stay in place
  permanently — removing either revokes that verification path.
- **Consent screen (Branding)**: app name FlowDesk, logo uploaded, homepage
  `https://flowdeskinbox.com`, privacy `https://flowdeskinbox.com/privacy`,
  terms `https://flowdeskinbox.com/terms`, authorized domain
  `flowdeskinbox.com` only.
- **OAuth clients**:
  - `FlowDesk Local` (production): redirect URIs are only
    `https://flowdeskinbox.com/api/connectors/gmail/callback` and
    `https://flowdeskinbox.com/api/connectors/google-calendar/callback`.
    Never add localhost URIs here — verification reviewers flag them.
  - `FlowDesk Dev (localhost)`: holds the `http://localhost:3000` equivalents
    for local development; its credentials live only in local `.env`.
- **Scopes requested** (`lib/google.ts`): `gmail.readonly`, `gmail.send`,
  `gmail.modify` (restricted), `calendar` (sensitive), plus
  `userinfo.email`/`userinfo.profile`. Google Drive was removed (PR #135) —
  if it returns, use the non-restricted `drive.file` scope.

## Scope justifications (paste into the verification form)

One box per scope; tweak freely.

> **`gmail.readonly`** — FlowDesk is an AI email assistant that organizes the
> user's inbox and drafts replies for their review. This scope is used to sync
> the user's email messages and thread metadata so the app can display their
> inbox and automatically classify each conversation (e.g. Needs Reply,
> Waiting On, Newsletter, Notification) and track follow-ups. Full message
> content is required — narrower scopes such as gmail.metadata are
> insufficient because classification and reply drafting depend on the message
> body. All synced data is used solely to provide these user-facing features,
> consistent with the Limited Use requirements.

> **`gmail.modify`** — Used to write the user's organizational state back into
> Gmail so FlowDesk's organization is visible natively in their inbox:
> creating and applying FlowDesk's workflow labels (Needs Reply, Waiting On,
> Handled, etc.), archiving and marking messages read/unread when the user or
> a user-configured automation does so, and creating or withdrawing reply
> drafts in the user's Gmail drafts. This is the narrowest scope that permits
> label management and draft creation. FlowDesk never deletes the user's
> messages.

> **`gmail.send`** — Used to send email replies composed in FlowDesk, only
> when the user explicitly approves a draft, or when the user has opted in to
> auto-send for specific categories they configure at the highest automation
> level. Every send is recorded in the user's in-app audit log so they can
> always see what was sent on their behalf.

> **`calendar`** (if the form asks) — Used to read free/busy availability so
> FlowDesk can propose meeting slots in reply drafts, and to create calendar
> holds and booked events when the user approves a scheduling confirmation.

If asked about Limited Use compliance: data is used only for user-facing
features, never for ads, never sold, never used to train generalized AI/ML
models, and humans do not read it except with permission or for
security/legal reasons — mirroring the Privacy Policy (`/privacy`).

## Demo video checklist (3–5 min, unlisted YouTube)

Record one continuous flow that maps onto the justifications:

1. Sign up / log in at flowdeskinbox.com (URL bar visible).
2. Click Connect Gmail → show the Google consent screen.
3. Inbox syncing; classifications/labels appearing in FlowDesk **and** in
   Gmail itself (`gmail.readonly` + `gmail.modify`).
4. A reply draft created by FlowDesk, then the user approving it and the
   email sending (`gmail.send`).

## Submission and renewal

1. Publish the app: Google Auth Platform → Audience → Publish app
   (Testing → In production). Testing mode caps at 100 test users and expires
   refresh tokens after 7 days.
2. Submit in Google Auth Platform → Verification Center with the
   justifications and video above. Brand review takes days; scope review
   weeks.
3. CASA Tier 2 security assessment: Google emails a link after submission;
   TAC Security's self-scan tier is the cheapest route. **Renews annually.**
