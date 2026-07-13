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
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 fill-none stroke-white/30"
            strokeWidth="1.5"
          >
            <path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2-5.6-3.2-5.6 3.2 1.3-6.2L3 9.5l6.3-.7z" />
          </svg>
        </span>

        <span
          className={`w-28 sm:w-40 shrink-0 truncate ${
            bold || typing ? "font-semibold text-white" : "text-[#bdc1c6]"
          }`}
        >
          {typing ? (
            <>
              Shivansh, <span className="font-normal text-[#e8734a]">Draft</span> 2
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
        <span className="text-[15px] font-medium tracking-tight text-white/90">
          Gmail
        </span>
        <div className="mx-2 flex h-8 max-w-md flex-1 items-center gap-2 rounded-full bg-white/[0.08] px-3 text-xs text-white/50">
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 fill-none stroke-current"
            strokeWidth="2"
          >
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
        <div className="hidden w-12 flex-col items-center gap-3 pb-4 pt-1 sm:flex">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 fill-none stroke-black"
              strokeWidth="1.7"
            >
              <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z" />
            </svg>
          </div>
          {["#8ab4f8", "#f28b82", "#fdd663", "#81c995", "#ff8bcb", "#c58af9"].map(
            (c) => (
              <span
                key={c}
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: c }}
              />
            )
          )}
        </div>

        <div className="min-w-0 flex-1 pb-2 pr-2">
          {/* toolbar */}
          <div className="flex items-center gap-4 rounded-t-lg bg-white/[0.03] px-4 py-2 text-white/50">
            <span className="h-3.5 w-3.5 rounded-[3px] border border-white/40" />
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 fill-none stroke-current"
              strokeWidth="1.8"
            >
              <path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" />
            </svg>
            <span className="ml-auto text-xs tabular-nums" data-testid="hero-counter">
              {counterAt(p)}
            </span>
          </div>

          {/* the wipe stage */}
          <div className="relative overflow-hidden rounded-b-lg bg-[#1c1c1e]">
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
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 fill-none stroke-current"
            strokeWidth="2"
          >
            <path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" />
          </svg>
          Replay
        </button>
      )}
    </div>
  );
}
