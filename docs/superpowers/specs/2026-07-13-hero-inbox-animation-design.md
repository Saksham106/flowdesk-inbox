# Hero Inbox Animation — Design

**Date:** 2026-07-13
**Status:** Approved (user picked option 3 + option 4 combined, phased)

## Goal

Replace the static hero screenshot (`product-screenshot.png`) on the landing
page with a live, user-controllable before/after demo of FlowDesk organizing an
inbox. "Before" = chaotic Gmail (thousands unread, no labels, newsletter spam).
"After" = the current clean labeled state, including an autodrafted reply the
user can see being written.

Two phases, shipped in one PR unless noted:

- **Phase A — self-organizing DOM inbox:** the screenshot becomes real DOM rows
  and a progress-driven timeline transforms mess → clean.
- **Phase B — lighthouse beam wipe:** the user drags a vertical light beam
  (brand motif: the FlowDesk lighthouse) across the inbox; the beam position
  drives the same progress value spatially.

## Architecture

New files under `app/components/landing/`:

- `HeroInboxDemo.tsx` (`"use client"`) — the whole demo: Gmail-style chrome,
  row list, beam overlay, progress driver. Replaces the `<img>` inside the
  framed card in `Hero.tsx`.
- `heroInboxData.ts` — static row data + label-chip definitions + per-row
  keyframe thresholds. Pure data/functions so they are unit-testable.

`Hero.tsx` keeps its layout/frame and swaps the `<img>` for
`<HeroInboxDemo />`.

### The single source of truth: progress `p ∈ [0, 1]`

Everything is a pure function of one master progress value:

- Phase A autoplay animates `p` 0 → 1 over ~5s (eased, driven by one
  `requestAnimationFrame` loop).
- Phase B maps the beam's horizontal position directly to `p`
  (left edge = 0, right edge = 1). Dragging the beam scrubs the whole
  transformation deterministically, including backwards.

Row state derivation lives in `heroInboxData.ts`:
`rowStateAt(p, row) → { chipsVisible, archived, unreadBold, typedChars }`.
No timers per row; a single driver re-renders from `p`.

### Row model (from the real product screenshot)

~12 rows copied from the production screenshot (Shortform Articles, Google
Play, Insight Academy, Supabase, Uber, Quora Digest, Reddit, Cloudflare,
Claude Team, Marc at Master.dev, noreply…) with their real chips:
`Handled` (gray), `Newsletter` (yellow), `Read Later` (pink), `Needs Action`
(orange), `Notification` (blue), `Marketing` (red), `Autodrafted` (purple).

Before-state deltas per row:

- All rows bold/unread, no chips.
- 3–4 extra pure-junk promo rows exist only in the before state.
- Toolbar counter reads `1–50 of 5,918`.

After-state deltas:

- Chips visible, most rows read-weight.
- Junk rows archived: the row content slides right and fades, leaving a
  ghosted "Archived ✓" row of the same height. (Constant row heights are
  required so the Phase B wipe edge lines up — a wipe cannot show two
  different list heights at once — so Phase A uses the same treatment.)
- Counter reads `1–12 of 12`.
- Finale row: `Shivansh, Draft 2` with orange **Draft** marker, purple
  `Autodrafted` chip, and the reply snippet typing out character by character
  (typed length is a function of `p`, so scrubbing rewinds the typing).

### Timeline beats (as p advances)

1. `p 0.08–0.55` — chips stamp onto rows one at a time (staggered pop), rows
   lose bold as they're handled. (The beam itself is the scan; no separate
   scanline element.)
2. `p 0.40–0.68` — junk rows archive; counter ticks 5,918 → 12.
3. `p 0.68–0.88` — the draft row transforms and its snippet types itself out.
4. Rest position `p ≈ 0.92` — everything is finished (draft fully typed)
   while a sliver of "before" stays visible on the right, inviting a grab.

### Beam (Phase B)

- A soft vertical light gradient (warm white/yellow, echoing the hero's
  lighthouse art) with a grabbable handle; `cursor: grab`, pointer events so
  touch works.
- Rows render as two stacked layers (before/after) clipped with
  `clip-path: inset()` at the beam's x — the transformation edge is per-pixel,
  not a crossfade. Global effects (counter, typing) remain p-driven.
- On first scroll into view the beam auto-sweeps left → right once (~5s), then
  rests at ~92% with a subtle idle shimmer inviting the user to grab it.

## Controls & accessibility

- Replay button (small, bottom-right of the frame) resets `p` to 0 and
  replays.
- Beam handle is keyboard-operable (`role="slider"`, arrow keys adjust `p`,
  `aria-valuetext` like "inbox 60% organized").
- `prefers-reduced-motion`: no autoplay, no idle shimmer; render the final
  clean state; the beam/slider still works (discrete, no eased animation).
- Server render outputs the final clean state so no-JS/SEO sees the real
  product; the client resets to `p=0` only when motion is allowed and the
  demo enters the viewport (avoids a flash of mess for reduced-motion users).

## Performance

- Only `transform`, `opacity`, and `clip-path` animate; single rAF driver;
  no per-row timers. Archive collapse (Phase A) uses `grid-template-rows`
  transition on a handful of rows, once per play.
- Static PNG stays in the repo as the OpenGraph/social image; it is no longer
  rendered in the hero.

## Error handling

Component is purely presentational with static data — no network, no error
states. Guards: clamp `p` to [0,1]; pointer capture released on
`pointercancel`; rAF cancelled on unmount.

## Testing

- Vitest unit tests for `heroInboxData.ts`: `rowStateAt` at p=0 (all messy),
  p=1 (all clean, junk archived, full snippet typed), monotonic chip
  thresholds, counter interpolation endpoints.
- Required checks: `npm test`, `npx tsc --noEmit`, `npm run lint`.
- Visual verification via claude-in-chrome on the dev server: autoplay, drag
  scrub (forward + backward), replay, reduced-motion, mobile viewport width.

## Out of scope

- No changes to other landing sections or the app itself.
- No new screenshot-capture pipeline work.
