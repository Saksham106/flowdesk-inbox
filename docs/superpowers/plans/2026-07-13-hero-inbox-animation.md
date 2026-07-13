# Hero Inbox Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static hero screenshot with a live DOM inbox that transforms from messy to organized, driven by one progress value the user can scrub with a draggable lighthouse-beam wipe.

**Architecture:** Pure data + state functions in `heroInboxData.ts` (unit-tested); one client component `HeroInboxDemo.tsx` renders a messy "before" row list with a clipped "after" layer on top; a single `p ∈ [0,1]` value drives clip position, chip stamping, archiving, counter, and draft typing. Autoplay sweeps `p` once on first view; dragging the beam maps pointer x → `p`.

**Tech Stack:** Next.js App Router, React client component, Tailwind + a few globals.css keyframes, Vitest (node env).

**Spec:** `docs/superpowers/specs/2026-07-13-hero-inbox-animation-design.md`

## Global Constraints

- Work only in worktree `.worktrees/feat-hero-inbox-animation`, branch `feat/hero-inbox-animation`. Never commit to main.
- Only `transform`, `opacity`, `clip-path` animate; one rAF driver; no per-row timers.
- Server render must output the finished (clean) state — no hydration mismatch, no flash of mess for reduced-motion users.
- `prefers-reduced-motion`: no autoplay, no shimmer, no replay button; beam still draggable/keyboard-operable.
- Timeline constants (single source of truth, `TIMELINE` in `heroInboxData.ts`): labels 0.08–0.55, archive 0.40–0.68, typing 0.68–0.88, rest at 0.92, sweep ≈ 5200 ms.
- Required checks before PR: `npm test`, `npx tsc --noEmit`, `npm run lint`.

---

### Task 1: Row data + pure timeline functions (TDD)

**Files:**
- Create: `app/components/landing/heroInboxData.ts`
- Test: `tests/hero-inbox-demo.test.ts`

**Interfaces:**
- Produces: `ChipKind`, `HeroRow`, `RowState`, `TIMELINE`, `CHIP_STYLES`, `HERO_ROWS: HeroRow[]`, `rowStateAt(p: number, row: HeroRow): RowState`, `counterAt(p: number): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hero-inbox-demo.test.ts
import { describe, expect, it } from "vitest";
import {
  HERO_ROWS,
  TIMELINE,
  counterAt,
  rowStateAt,
} from "@/app/components/landing/heroInboxData";

describe("hero inbox timeline", () => {
  it("p=0 is fully messy: no chips, nothing archived, all bold, nothing typed", () => {
    for (const row of HERO_ROWS) {
      const s = rowStateAt(0, row);
      expect(s.chipsVisible).toBe(false);
      expect(s.archived).toBe(false);
      expect(s.bold).toBe(true);
      expect(s.typedChars).toBe(0);
    }
    expect(counterAt(0)).toBe("1–50 of 5,918");
  });

  it("p=1 is fully organized: chips on kept rows, junk archived, draft fully typed", () => {
    for (const row of HERO_ROWS) {
      const s = rowStateAt(1, row);
      if (row.junk) {
        expect(s.archived).toBe(true);
        expect(s.chipsVisible).toBe(false);
      } else {
        expect(s.archived).toBe(false);
        expect(s.chipsVisible).toBe(true);
        expect(s.bold).toBe(!!row.boldAfter);
      }
      if (row.draft) expect(s.typedChars).toBe(row.snippet.length);
    }
    expect(counterAt(1)).toBe("1–12 of 12");
  });

  it("rest position shows the finished state (draft typed, junk archived)", () => {
    const p = TIMELINE.restAt;
    const draft = HERO_ROWS.find((r) => r.draft)!;
    expect(rowStateAt(p, draft).typedChars).toBe(draft.snippet.length);
    for (const row of HERO_ROWS.filter((r) => r.junk)) {
      expect(rowStateAt(p, row).archived).toBe(true);
    }
    expect(counterAt(p)).toBe("1–12 of 12");
  });

  it("labeling is staggered top-to-bottom within the label window", () => {
    const kept = HERO_ROWS.filter((r) => !r.draft);
    for (let i = 1; i < kept.length; i++) {
      expect(kept[i].labelAt).toBeGreaterThanOrEqual(kept[i - 1].labelAt);
    }
    for (const row of kept) {
      expect(row.labelAt).toBeGreaterThanOrEqual(TIMELINE.labelStart);
      expect(row.labelAt).toBeLessThanOrEqual(TIMELINE.labelEnd);
    }
  });

  it("archiving is staggered: mid-window some junk is archived and some is not", () => {
    const junk = HERO_ROWS.filter((r) => r.junk);
    expect(junk.length).toBeGreaterThanOrEqual(3);
    const mid = (junk[0].archiveAt! + junk[junk.length - 1].archiveAt!) / 2;
    const archivedCount = junk.filter((r) => rowStateAt(mid, r).archived).length;
    expect(archivedCount).toBeGreaterThan(0);
    expect(archivedCount).toBeLessThan(junk.length);
  });

  it("draft typing only happens inside the typing window", () => {
    const draft = HERO_ROWS.find((r) => r.draft)!;
    expect(rowStateAt(TIMELINE.typeStart, draft).typedChars).toBe(0);
    const midTyped = rowStateAt(
      (TIMELINE.typeStart + TIMELINE.typeEnd) / 2,
      draft
    ).typedChars;
    expect(midTyped).toBeGreaterThan(0);
    expect(midTyped).toBeLessThan(draft.snippet.length);
  });

  it("counter interpolates monotonically", () => {
    const totals: number[] = [];
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const m = counterAt(p).match(/of ([\d,]+)$/)!;
      totals.push(Number(m[1].replace(/,/g, "")));
    }
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hero-inbox-demo.test.ts`
Expected: FAIL — cannot resolve `@/app/components/landing/heroInboxData`.

- [ ] **Step 3: Implement the data module**

```ts
// app/components/landing/heroInboxData.ts
// Pure data + state functions for the hero inbox demo. Everything the
// animation shows is a deterministic function of one progress value p ∈ [0,1]
// so the beam can scrub it forwards and backwards.

export type ChipKind =
  | "handled"
  | "newsletter"
  | "readLater"
  | "needsAction"
  | "notification"
  | "marketing"
  | "autodrafted";

export interface HeroRow {
  id: string;
  sender: string;
  chips: ChipKind[];
  subject: string;
  snippet: string;
  date: string;
  /** p threshold at which this row gets its chips / loses unread bold */
  labelAt: number;
  /** stays visually bold even after being handled (mirrors real screenshot) */
  boldAfter?: boolean;
  /** archived by the transformation; exists as junk in the before state */
  junk?: boolean;
  /** p threshold at which a junk row archives */
  archiveAt?: number;
  /** the finale row whose reply snippet types itself out */
  draft?: boolean;
  /** before-state overrides (the draft row reads as a plain unanswered email) */
  beforeSender?: string;
  beforeSubject?: string;
  beforeSnippet?: string;
}

export interface RowState {
  chipsVisible: boolean;
  archived: boolean;
  bold: boolean;
  typedChars: number;
}

export const TIMELINE = {
  labelStart: 0.08,
  labelEnd: 0.55,
  archiveStart: 0.4,
  archiveEnd: 0.68,
  typeStart: 0.68,
  typeEnd: 0.88,
  restAt: 0.92,
  sweepMs: 5200,
} as const;

export const CHIP_STYLES: Record<ChipKind, { label: string; bg: string; fg: string }> = {
  handled: { label: "Handled", bg: "#d5cbbb", fg: "#3b3428" },
  newsletter: { label: "Newsletter", bg: "#f0e096", fg: "#4a4014" },
  readLater: { label: "Read Later", bg: "#f3c2d7", fg: "#57182f" },
  needsAction: { label: "Needs Action", bg: "#f5c26b", fg: "#4d340a" },
  notification: { label: "Notification", bg: "#a5d3e8", fg: "#123a4c" },
  marketing: { label: "Marketing", bg: "#f0a49b", fg: "#521a13" },
  autodrafted: { label: "Autodrafted", bg: "#d4c3f5", fg: "#31205e" },
};

type RawRow = Omit<HeroRow, "labelAt" | "archiveAt">;

// Rows mirror public/images/landing/product-screenshot.png; junk rows are
// invented senders that only exist in the "before" state.
const RAW_ROWS: RawRow[] = [
  {
    id: "shortform-1",
    sender: "Shortform Articles",
    chips: ["newsletter", "readLater"],
    subject: "Author Michael Lews plumbs the depths of greed",
    snippet: "Plus, check out the most popular guides this week",
    date: "Jul 10",
    boldAfter: true,
  },
  {
    id: "google-play",
    sender: "Google Play",
    chips: ["handled"],
    subject: "Updates to Google Play Terms of Service",
    snippet: "On July 29, 2026, we're making some changes t",
    date: "Jul 10",
  },
  {
    id: "deals-daily",
    sender: "DealsDaily",
    chips: [],
    subject: "🔥 FINAL HOURS: 80% off EVERYTHING must go",
    snippet: "Don't miss out!!! Your cart is waiting and prices like",
    date: "Jul 10",
    junk: true,
  },
  {
    id: "insight-academy",
    sender: "Insight Academy",
    chips: ["handled", "needsAction", "notification"],
    subject: "Reset Your Password",
    snippet: "Reset Your Password Hi, Click the button below",
    date: "Jul 10",
  },
  {
    id: "supabase",
    sender: "Supabase",
    chips: ["handled", "notification"],
    subject: "Your Supabase Project insight is running out of Disk IO Budget",
    snippet: "Hey there, We",
    date: "Jul 9",
  },
  {
    id: "crypto-pulse",
    sender: "CryptoPulse Weekly",
    chips: [],
    subject: "🚀 10 coins about to EXPLODE (number 7 will shock you)",
    snippet: "Unsubscribe? Never! Here's what the whales are buying",
    date: "Jul 9",
    junk: true,
  },
  {
    id: "uber",
    sender: "Uber",
    chips: ["handled", "marketing"],
    subject: "Get up to 50% OFF on your first Metro ticket",
    snippet: "Uber One app, full journey —",
    date: "Jul 9",
    boldAfter: true,
  },
  {
    id: "quora",
    sender: "Quora Digest",
    chips: ["newsletter", "readLater"],
    subject: "Is Vietnam safer than China?",
    snippet: "As a Chinese who has lived in Vietnam, let m",
    date: "Jul 9",
    boldAfter: true,
  },
  {
    id: "shivansh-draft",
    sender: "Shivansh, Draft 2",
    chips: ["autodrafted"],
    subject: "Re: Quick sync this week?",
    snippet: "Hi Shivansh — Thursday 2pm works great. I've attached the numbers you asked about.",
    date: "Jul 8",
    draft: true,
    beforeSender: "Shivansh Goel",
    beforeSubject: "Quick sync this week?",
    beforeSnippet: "Did you get a chance to look at the numbers? Still",
  },
  {
    id: "reddit",
    sender: "Reddit",
    chips: ["handled", "needsAction", "notification"],
    subject: "Reddit password reset",
    snippet: "Hi there, Thanks for requesting a pass",
    date: "Jul 8",
    boldAfter: true,
  },
  {
    id: "supersaver",
    sender: "SuperSaver Club",
    chips: [],
    subject: "You've been SELECTED ⭐ claim your reward now",
    snippet: "Congratulations! You are one of 10,000 lucky members",
    date: "Jul 8",
    junk: true,
  },
  {
    id: "cloudflare-invoice",
    sender: "Cloudflare",
    chips: ["handled", "notification"],
    subject: "Your invoice is available",
    snippet: "Invoice IN-70737729: $10.46 due July 7, 2026 Cloudfl",
    date: "Jul 8",
  },
  {
    id: "claude-team",
    sender: "Claude Team",
    chips: ["handled", "notification"],
    subject: "Fable 5 access is extended through Sunday",
    snippet: "Through Sunday, July 12, then us",
    date: "Jul 8",
  },
  {
    id: "marc",
    sender: "Marc at Master.dev",
    chips: ["newsletter", "readLater"],
    subject: "July #39: We're Now Master.dev, Fable 5 Returns & DevTools Goes Agen",
    snippet: "The big rename, plus everything we shipped",
    date: "Jul 7",
    boldAfter: true,
  },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 0 before start, 1 after end, linear in between */
export const spanProgress = (p: number, start: number, end: number) =>
  clamp01((p - start) / (end - start));

const junkCount = RAW_ROWS.filter((r) => r.junk).length;
let junkSeen = 0;

export const HERO_ROWS: HeroRow[] = RAW_ROWS.map((row, i) => {
  const labelSpan = TIMELINE.labelEnd - TIMELINE.labelStart;
  const labelAt = row.draft
    ? TIMELINE.typeStart // draft chip pops when typing starts
    : TIMELINE.labelStart + (i / (RAW_ROWS.length - 1)) * labelSpan;
  let archiveAt: number | undefined;
  if (row.junk) {
    const archiveSpan = TIMELINE.archiveEnd - TIMELINE.archiveStart;
    archiveAt =
      TIMELINE.archiveStart + (junkSeen / Math.max(1, junkCount - 1)) * archiveSpan;
    junkSeen += 1;
  }
  return { ...row, labelAt, archiveAt };
});

export function rowStateAt(p: number, row: HeroRow): RowState {
  const labeled = p >= row.labelAt;
  const archived = !!row.junk && row.archiveAt !== undefined && p >= row.archiveAt;
  const typedChars = row.draft
    ? Math.round(spanProgress(p, TIMELINE.typeStart, TIMELINE.typeEnd) * row.snippet.length)
    : 0;
  return {
    chipsVisible: labeled && !archived && row.chips.length > 0,
    archived,
    bold: labeled ? !!row.boldAfter : true,
    typedChars,
  };
}

const BEFORE_TOTAL = 5918;
const AFTER_TOTAL = 12;
const BEFORE_PAGE_END = 50;

export function counterAt(p: number): string {
  const t = spanProgress(p, TIMELINE.archiveStart, TIMELINE.archiveEnd);
  const total = Math.round(BEFORE_TOTAL + (AFTER_TOTAL - BEFORE_TOTAL) * t);
  const end = Math.round(BEFORE_PAGE_END + (AFTER_TOTAL - BEFORE_PAGE_END) * t);
  return `1–${end.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hero-inbox-demo.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/heroInboxData.ts tests/hero-inbox-demo.test.ts
git commit -m "feat: hero inbox demo data + progress-driven timeline functions"
```

---

### Task 2: HeroInboxDemo component — Phase A (self-organizing inbox)

**Files:**
- Create: `app/components/landing/HeroInboxDemo.tsx`
- Modify: `app/components/landing/Hero.tsx` (swap `<img>` → `<HeroInboxDemo />`)
- Modify: `app/globals.css` (chip pop / archive / caret keyframes)

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: `HeroInboxDemo` default export, no props. Internally keeps `p` in state; Task 3 attaches the beam to the same `p`.

- [ ] **Step 1: Implement the component**

The component renders Gmail-style chrome (left rail, search bar, toolbar with live counter) and TWO row lists stacked: the messy "before" list as the base layer and the organized "after" list absolutely positioned on top, clipped by `clip-path: inset(0 X% 0 0)` where `X = (1-p)·100`. In Task 2 the clip is driven only by autoplay; Task 3 makes it draggable.

```tsx
// app/components/landing/HeroInboxDemo.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHIP_STYLES,
  HERO_ROWS,
  TIMELINE,
  counterAt,
  rowStateAt,
  type ChipKind,
  type HeroRow,
} from "./heroInboxData";

function Chip({ kind, pop }: { kind: ChipKind; pop: boolean }) {
  const c = CHIP_STYLES[kind];
  return (
    <span
      className={`inline-block shrink-0 rounded px-1.5 py-px text-[10px] font-medium leading-4 ${
        pop ? "hero-chip-pop" : ""
      }`}
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {c.label}
    </span>
  );
}

function InboxRow({ row, p, after }: { row: HeroRow; p: number; after: boolean }) {
  const s = rowStateAt(p, row);
  const sender = after ? row.sender : row.beforeSender ?? row.sender;
  const subject = after ? row.subject : row.beforeSubject ?? row.subject;
  const snippet = after ? row.snippet : row.beforeSnippet ?? row.snippet;
  const bold = after ? s.bold : true;
  const archived = after && s.archived;
  const chips = after && s.chipsVisible ? row.chips : [];
  const typing = after && !!row.draft;
  const typed = typing ? snippet.slice(0, s.typedChars) : snippet;

  return (
    <div className="relative flex h-11 items-center gap-3 border-b border-white/[0.06] px-3 sm:px-4 text-[13px]">
      {/* archived ghost overlay */}
      <span
        className={`pointer-events-none absolute inset-0 flex items-center px-4 text-xs text-white/40 transition-opacity duration-500 ${
          archived ? "opacity-100" : "opacity-0"
        }`}
      >
        ✓ Archived
      </span>

      <span
        className={`flex min-w-0 flex-1 items-center gap-3 transition-all duration-500 ${
          archived ? "translate-x-6 opacity-0" : ""
        }`}
      >
        <span className="hidden sm:flex items-center gap-3 text-white/30">
          <span className="h-3.5 w-3.5 rounded-[3px] border border-white/30" />
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-white/30" strokeWidth="1.5">
            <path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2-5.6-3.2-5.6 3.2 1.3-6.2L3 9.5l6.3-.7z" />
          </svg>
        </span>

        <span
          className={`w-28 sm:w-40 shrink-0 truncate ${
            bold ? "font-semibold text-white" : "text-[#bdc1c6]"
          } ${typing && after ? "text-white" : ""}`}
        >
          {typing ? (
            <>
              Shivansh, <span className="text-[#e8734a]">Draft</span> 2
            </>
          ) : (
            sender
          )}
        </span>

        <span className="hidden md:flex items-center gap-1 shrink-0">
          {chips.map((kind) => (
            <Chip key={kind} kind={kind} pop />
          ))}
        </span>

        <span className="min-w-0 flex-1 truncate">
          <span className={bold ? "font-semibold text-white" : "text-[#bdc1c6]"}>
            {subject}
          </span>
          <span className="text-white/40">
            {" "}
            – {typed}
            {typing && s.typedChars > 0 && s.typedChars < snippet.length && (
              <span className="hero-caret" />
            )}
          </span>
        </span>

        <span
          className={`shrink-0 text-xs ${
            bold ? "font-semibold text-white" : "text-white/50"
          }`}
        >
          {row.date}
        </span>
      </span>
    </div>
  );
}

function InboxList({ p, after }: { p: number; after: boolean }) {
  return (
    <div aria-hidden={!after}>
      {HERO_ROWS.map((row) => (
        <InboxRow key={row.id} row={row} p={p} after={after} />
      ))}
    </div>
  );
}

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export default function HeroInboxDemo() {
  // Server renders the finished state; the client rewinds and plays only
  // when motion is allowed and the demo is in view.
  const [p, setP] = useState<number>(TIMELINE.restAt);
  const [reducedMotion, setReducedMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const playedRef = useRef(false);

  const cancelSweep = useCallback(() => cancelAnimationFrame(rafRef.current), []);

  const sweep = useCallback(
    (from: number, to: number, ms: number) => {
      cancelSweep();
      let start = 0;
      const frame = (now: number) => {
        if (!start) start = now;
        const t = Math.min(1, (now - start) / ms);
        setP(from + (to - from) * easeInOutSine(t));
        if (t < 1) rafRef.current = requestAnimationFrame(frame);
      };
      rafRef.current = requestAnimationFrame(frame);
    },
    [cancelSweep]
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReducedMotion(true);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !playedRef.current) {
          playedRef.current = true;
          setP(0);
          sweep(0, TIMELINE.restAt, TIMELINE.sweepMs);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelSweep();
    };
  }, [sweep, cancelSweep]);

  const replay = useCallback(() => {
    setP(0);
    sweep(0, TIMELINE.restAt, TIMELINE.sweepMs);
  }, [sweep]);

  const clipRight = (1 - p) * 100;

  return (
    <div
      ref={containerRef}
      className="relative bg-[#161618] text-left font-sans"
      aria-label="Demo: FlowDesk organizing a Gmail inbox"
    >
      {/* top chrome */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex flex-col gap-[3px] p-1" aria-hidden="true">
          <span className="h-[2px] w-4 bg-white/60" />
          <span className="h-[2px] w-4 bg-white/60" />
          <span className="h-[2px] w-4 bg-white/60" />
        </div>
        <span className="text-[15px] font-medium text-white/90 tracking-tight">Gmail</span>
        <div className="mx-2 flex h-8 flex-1 max-w-md items-center gap-2 rounded-full bg-white/[0.08] px-3 text-xs text-white/50">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          Search mail
        </div>
        <div className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-[#7c4dbe] text-[11px] font-medium text-white">
          S
        </div>
      </div>

      <div className="flex">
        {/* left rail */}
        <div className="hidden sm:flex w-12 flex-col items-center gap-3 pt-1 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-black" strokeWidth="1.7">
              <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z" />
            </svg>
          </div>
          {["#8ab4f8", "#f28b82", "#fdd663", "#81c995", "#ff8bcb", "#c58af9"].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c }} />
          ))}
        </div>

        <div className="min-w-0 flex-1 pb-2 pr-2">
          {/* toolbar */}
          <div className="flex items-center gap-4 rounded-t-lg bg-white/[0.03] px-4 py-2 text-white/50">
            <span className="h-3.5 w-3.5 rounded-[3px] border border-white/40" />
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
              <path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" />
            </svg>
            <span className="ml-auto text-xs tabular-nums" data-testid="hero-counter">
              {counterAt(p)}
            </span>
          </div>

          {/* the wipe stage — beam overlay attaches here in Task 3 */}
          <div className="relative overflow-hidden bg-[#1c1c1e] rounded-b-lg">
            <InboxList p={p} after={false} />
            <div
              className="absolute inset-0 bg-[#1c1c1e]"
              style={{ clipPath: `inset(0 ${clipRight}% 0 0)` }}
            >
              <InboxList p={p} after />
            </div>
          </div>
        </div>
      </div>

      {!reducedMotion && (
        <button
          type="button"
          onClick={replay}
          className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 backdrop-blur transition-colors hover:bg-white/20"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2">
            <path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" />
          </svg>
          Replay
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Swap the hero image for the demo**

In `app/components/landing/Hero.tsx`, replace the `<img src="/images/landing/product-screenshot.png" …/>` element (keep the framed wrapper div) with:

```tsx
<HeroInboxDemo />
```

and add the import:

```tsx
import HeroInboxDemo from "@/app/components/landing/HeroInboxDemo";
```

- [ ] **Step 3: Add keyframes to `app/globals.css`**

```css
/* ── Hero inbox demo ───────────────────────────────────────── */
@keyframes hero-chip-pop {
  0% { transform: scale(0.6); opacity: 0; }
  70% { transform: scale(1.08); }
  100% { transform: scale(1); opacity: 1; }
}
.hero-chip-pop { animation: hero-chip-pop 260ms ease-out both; }

.hero-caret {
  display: inline-block;
  width: 1px;
  height: 0.9em;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: #e8eaed;
  animation: hero-caret-blink 0.9s steps(1) infinite;
}
@keyframes hero-caret-blink { 50% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .hero-chip-pop { animation: none; }
  .hero-caret { animation: none; }
}
```

- [ ] **Step 4: Verify build + tests**

Run: `npx tsc --noEmit && npx vitest run tests/hero-inbox-demo.test.ts && npm run lint`
Expected: all pass.

- [ ] **Step 5: Visual check in dev server (manual/Chrome)**

Run `npm run dev`, load `/`, confirm: autoplay sweep on load, chips pop, junk rows turn into "✓ Archived", counter ticks down, draft row types itself, replay button works.

- [ ] **Step 6: Commit**

```bash
git add app/components/landing/HeroInboxDemo.tsx app/components/landing/Hero.tsx app/globals.css
git commit -m "feat: self-organizing DOM inbox replaces static hero screenshot"
```

---

### Task 3: Lighthouse beam wipe (Phase B)

**Files:**
- Modify: `app/components/landing/HeroInboxDemo.tsx`
- Modify: `app/globals.css` (beam shimmer)

**Interfaces:**
- Consumes: `p` state + `sweep`/`cancelSweep` from Task 2.
- Produces: draggable/keyboard-operable beam; no external interface changes.

- [ ] **Step 1: Add the beam overlay + drag/keyboard handling**

Inside the "wipe stage" div (position: relative), after the clipped after-layer, add the beam. Add refs/handlers to the component:

```tsx
const stageRef = useRef<HTMLDivElement>(null);
const draggingRef = useRef(false);

const pFromClientX = useCallback((clientX: number) => {
  const rect = stageRef.current!.getBoundingClientRect();
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}, []);

const onPointerDown = useCallback(
  (e: React.PointerEvent<HTMLDivElement>) => {
    cancelSweep();
    playedRef.current = true;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setP(pFromClientX(e.clientX));
  },
  [cancelSweep, pFromClientX]
);

const onPointerMove = useCallback(
  (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) setP(pFromClientX(e.clientX));
  },
  [pFromClientX]
);

const endDrag = useCallback(() => {
  draggingRef.current = false;
}, []);

const onKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 0.05;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      cancelSweep();
      setP((v) => Math.min(1, v + step));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      cancelSweep();
      setP((v) => Math.max(0, v - step));
    } else if (e.key === "Home") {
      cancelSweep();
      setP(0);
    } else if (e.key === "End") {
      cancelSweep();
      setP(1);
    } else {
      return;
    }
    e.preventDefault();
  },
  [cancelSweep]
);
```

Attach `ref={stageRef}` to the wipe stage div. Beam markup, inside the stage (rendered after the clipped layer):

```tsx
{/* lighthouse beam divider */}
<div
  className="absolute inset-y-0 z-10 touch-none"
  style={{ left: `calc(${p * 100}% - 22px)`, width: 44, cursor: "grab" }}
  role="slider"
  tabIndex={0}
  aria-label="Drag to organize the inbox"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(p * 100)}
  aria-valuetext={`Inbox ${Math.round(p * 100)}% organized`}
  onPointerDown={onPointerDown}
  onPointerMove={onPointerMove}
  onPointerUp={endDrag}
  onPointerCancel={endDrag}
  onKeyDown={onKeyDown}
>
  {/* light cone */}
  <div className="hero-beam-cone pointer-events-none absolute inset-y-0 left-1/2 w-40 -translate-x-1/2" />
  {/* hard edge */}
  <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-[#ffedbe]/90 shadow-[0_0_24px_6px_rgba(255,220,150,0.45)]" />
  {/* handle */}
  <div
    className={`absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#fff7e0] text-[#6b5210] shadow-[0_0_16px_4px_rgba(255,220,150,0.55)] ${
      !reducedMotion ? "hero-beam-idle" : ""
    }`}
  >
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2">
      <path d="M8 7l-4 5 4 5M16 7l4 5-4 5" />
    </svg>
  </div>
</div>
```

- [ ] **Step 2: Beam CSS in `app/globals.css`**

```css
.hero-beam-cone {
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 236, 190, 0.16) 45%,
    rgba(255, 236, 190, 0.16) 55%,
    transparent
  );
  clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%);
}
@keyframes hero-beam-idle {
  0%, 100% { box-shadow: 0 0 16px 4px rgba(255, 220, 150, 0.55); }
  50% { box-shadow: 0 0 26px 9px rgba(255, 220, 150, 0.75); }
}
.hero-beam-idle { animation: hero-beam-idle 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .hero-beam-idle { animation: none; }
}
```

- [ ] **Step 3: Verify checks**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 4: Visual check (Chrome)**

Drag the beam forward and backward — rows transform exactly at the edge; typing rewinds when scrubbing back; keyboard arrows work on the focused handle; touch drag works at mobile width; reduced-motion renders rest state with a working (non-shimmering) beam.

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/HeroInboxDemo.tsx app/globals.css
git commit -m "feat: draggable lighthouse beam wipe for hero inbox demo"
```

---

### Task 4: Docs, required checks, PR

**Files:**
- Modify: `docs/CURRENT_STATE.md` (landing/hero section, if it describes the static screenshot)

- [ ] **Step 1: Update living docs** — `rg -n "product-screenshot|hero" docs/CURRENT_STATE.md` and update the description of the hero to mention the interactive demo.

- [ ] **Step 2: Full checks**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 3: Browser verification with claude-in-chrome** — autoplay, scrub both directions, replay, reduced-motion (emulate via DevTools), 375px viewport; record a GIF of the beam interaction.

- [ ] **Step 4: Commit docs, push, open PR**

```bash
git add docs/
git commit -m "docs: hero inbox animation in current state"
git push -u origin feat/hero-inbox-animation
gh pr create --title "feat: interactive before/after hero inbox with lighthouse beam wipe" --body "..."
```
