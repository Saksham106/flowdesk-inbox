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
          className={`w-24 sm:w-40 shrink-0 truncate ${
            bold || typing ? "font-semibold text-white" : "text-[#bdc1c6]"
          }`}
        >
          {typing ? (
            <>
              John, <span className="font-normal text-[#e8734a]">Draft</span> 2
            </>
          ) : (
            sender
          )}
        </span>

        {/* below md only the first chip fits alongside sender + subject */}
        <span className="flex items-center gap-1 shrink-0">
          {chips.map((kind, i) => (
            <span key={kind} className={i > 0 ? "hidden md:inline-flex" : "inline-flex"}>
              <Chip kind={kind} pop />
            </span>
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

// p position just past the left stage edge where the beam (edge + glow cone)
// is fully clipped away, so sweeps can start from off-stage
const BEAM_OFF_LEFT = -0.12;

// hover may not retrigger a replay until this long after a sweep settles
const HOVER_REPLAY_COOLDOWN_MS = 1000;
// while the cursor stays on the demo, replay again this long after settling
const HOVER_LOOP_DELAY_MS = 1800;

export default function HeroInboxDemo() {
  // Server renders the finished state; the client rewinds and plays only
  // when motion is allowed and the demo is in view.
  const [p, setP] = useState<number>(TIMELINE.restAt);
  const [reducedMotion, setReducedMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const playedRef = useRef(false);
  const pRef = useRef<number>(TIMELINE.restAt);

  const setProgress = useCallback((v: number) => {
    pRef.current = v;
    setP(v);
  }, []);

  const sweepingRef = useRef(false);

  const cancelSweep = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    sweepingRef.current = false;
  }, []);

  const sweep = useCallback(
    (from: number, to: number, ms: number, onDone?: () => void) => {
      cancelSweep();
      sweepingRef.current = true;
      let start = 0;
      const frame = (now: number) => {
        if (!start) start = now;
        const t = Math.min(1, (now - start) / ms);
        setProgress(from + (to - from) * easeInOutSine(t));
        if (t < 1) {
          rafRef.current = requestAnimationFrame(frame);
        } else {
          sweepingRef.current = false;
          onDone?.();
        }
      };
      rafRef.current = requestAnimationFrame(frame);
    },
    [cancelSweep, setProgress]
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const hoveredRef = useRef(false);
  const settledAtRef = useRef(0);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayRef = useRef<() => void>(() => {});

  const idleAtRest = useCallback(
    () =>
      !sweepingRef.current &&
      !draggingRef.current &&
      Math.abs(pRef.current - TIMELINE.restAt) < 0.02,
    []
  );

  // Called when a forward sweep settles at rest: start the hover cooldown,
  // and if the cursor is still on the demo, queue the next loop iteration.
  const onSettled = useCallback(() => {
    settledAtRef.current = performance.now();
    if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    loopTimerRef.current = setTimeout(() => {
      if (hoveredRef.current && !reducedMotion && idleAtRest()) {
        replayRef.current();
      }
    }, HOVER_LOOP_DELAY_MS);
  }, [reducedMotion, idleAtRest]);

  const replay = useCallback(() => {
    // quick smooth rewind to the left (the wipe visibly un-organizes the
    // inbox on the way back), then play forward
    sweep(Math.min(1, Math.max(0, pRef.current)), BEAM_OFF_LEFT, 650, () => {
      sweep(BEAM_OFF_LEFT, TIMELINE.restAt, TIMELINE.sweepMs, onSettled);
    });
  }, [sweep, onSettled]);

  useEffect(() => {
    replayRef.current = replay;
  }, [replay]);

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
          setProgress(BEAM_OFF_LEFT);
          sweep(BEAM_OFF_LEFT, TIMELINE.restAt, TIMELINE.sweepMs, onSettled);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelSweep();
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    };
  }, [sweep, cancelSweep, setProgress, onSettled]);

  // Hovering the demo replays it (and keeps looping while hovered), but only
  // from a settled rest state — never mid-sweep, mid-drag, or after the user
  // parked the beam somewhere on purpose — and not within the cooldown right
  // after a sweep finishes. Mouse only: on touch, pointerenter fires on every
  // tap. The Replay button stays instant and unthrottled.
  const onDemoPointerEnter = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== "mouse") return;
      hoveredRef.current = true;
      if (
        !reducedMotion &&
        playedRef.current &&
        idleAtRest() &&
        performance.now() - settledAtRef.current >= HOVER_REPLAY_COOLDOWN_MS
      ) {
        replay();
      }
    },
    [reducedMotion, replay, idleAtRest]
  );

  const onDemoPointerLeave = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") hoveredRef.current = false;
    },
    []
  );

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
      setProgress(pFromClientX(e.clientX));
    },
    [cancelSweep, pFromClientX, setProgress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (draggingRef.current) setProgress(pFromClientX(e.clientX));
    },
    [pFromClientX, setProgress]
  );

  const endDrag = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = 0.05;
      const clamped = Math.min(1, Math.max(0, pRef.current));
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        cancelSweep();
        setProgress(Math.min(1, clamped + step));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        cancelSweep();
        setProgress(Math.max(0, clamped - step));
      } else if (e.key === "Home") {
        cancelSweep();
        setProgress(0);
      } else if (e.key === "End") {
        cancelSweep();
        setProgress(1);
      } else {
        return;
      }
      e.preventDefault();
    },
    [cancelSweep, setProgress]
  );

  const clipRight = Math.min(100, Math.max(0, (1 - p) * 100));
  const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);

  return (
    <div
      ref={containerRef}
      className="relative select-none bg-[#161618] text-left font-sans"
      aria-label="Demo: FlowDesk organizing a Gmail inbox"
      onPointerEnter={onDemoPointerEnter}
      onPointerLeave={onDemoPointerLeave}
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
        <div className="mx-2 hidden h-8 max-w-md flex-1 items-center gap-2 rounded-full bg-white/[0.08] px-3 text-xs text-white/50 sm:flex">
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
        <div className="ml-auto flex items-center gap-3">
          {!reducedMotion && (
            <button
              type="button"
              onClick={replay}
              className="hero-replay-alive flex items-center gap-1.5 rounded-full bg-[#ffedbe] px-3 py-1.5 text-xs font-medium text-[#5c4a12] transition-transform hover:scale-105"
            >
              <svg
                viewBox="0 0 24 24"
                className="hero-replay-icon h-3.5 w-3.5 fill-none stroke-current"
                strokeWidth="2"
              >
                <path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" />
              </svg>
              Replay
            </button>
          )}
          <div className="h-6 w-6 overflow-hidden rounded-full">
            <img
              src="/images/landing/logo-icon.svg"
              alt=""
              className="h-full w-full scale-[1.5] object-cover"
              aria-hidden="true"
            />
          </div>
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
          <div ref={stageRef} className="relative overflow-hidden rounded-b-lg bg-[#1c1c1e]">
            <InboxList p={p} after={false} />
            <div
              className="absolute inset-0 bg-[#1c1c1e]"
              style={{ clipPath: `inset(0 ${clipRight}% 0 0)` }}
            >
              <InboxList p={p} after />
            </div>

            {/* lighthouse beam divider */}
            <div
              className="absolute inset-y-0 z-10 touch-none"
              style={{ left: `calc(${p * 100}% - 22px)`, width: 44, cursor: "grab" }}
              role="slider"
              tabIndex={0}
              aria-label="Drag to organize the inbox"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-valuetext={`Inbox ${pct}% organized`}
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
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 fill-none stroke-current"
                  strokeWidth="2"
                >
                  <path d="M8 7l-4 5 4 5M16 7l4 5-4 5" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
