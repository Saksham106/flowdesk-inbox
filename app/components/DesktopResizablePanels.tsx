"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  clampDesktopPanelLayout,
  DEFAULT_DESKTOP_PANEL_LAYOUT,
  DesktopPanelLayout,
} from "@/lib/resizable-panels";

type ResizeTarget = "left" | "right";

type Props = {
  left: ReactNode;
  main: ReactNode;
  right?: ReactNode;
  storageKey: string;
};

function readStoredLayout(storageKey: string): DesktopPanelLayout {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_DESKTOP_PANEL_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<DesktopPanelLayout>;
    return {
      leftWidth: Number(parsed.leftWidth),
      rightWidth: Number(parsed.rightWidth),
    };
  } catch {
    return DEFAULT_DESKTOP_PANEL_LAYOUT;
  }
}

export default function DesktopResizablePanels({ left, main, right, storageKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<DesktopPanelLayout>(DEFAULT_DESKTOP_PANEL_LAYOUT);
  const [hasLoadedStoredLayout, setHasLoadedStoredLayout] = useState(false);
  const [activeTarget, setActiveTarget] = useState<ResizeTarget | null>(null);
  const dragRef = useRef<{
    target: ResizeTarget;
    startX: number;
    startLeft: number;
    startRight: number;
  } | null>(null);

  const clampForContainer = useCallback(
    (next: DesktopPanelLayout) =>
      clampDesktopPanelLayout({
        containerWidth: containerRef.current?.clientWidth ?? 1400,
        leftWidth: next.leftWidth,
        rightWidth: right ? next.rightWidth : DEFAULT_DESKTOP_PANEL_LAYOUT.rightWidth,
      }),
    [right]
  );

  useEffect(() => {
    setLayout(clampForContainer(readStoredLayout(storageKey)));
    setHasLoadedStoredLayout(true);
  }, [clampForContainer, storageKey]);

  useEffect(() => {
    if (!hasLoadedStoredLayout) return;
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [hasLoadedStoredLayout, layout, storageKey]);

  useEffect(() => {
    function handleResize() {
      setLayout((current) => clampForContainer(current));
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampForContainer]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;

      const delta = event.clientX - drag.startX;
      setLayout(
        clampForContainer({
          leftWidth: drag.target === "left" ? drag.startLeft + delta : drag.startLeft,
          rightWidth: drag.target === "right" ? drag.startRight - delta : drag.startRight,
        })
      );
    }

    function onPointerUp() {
      dragRef.current = null;
      setActiveTarget(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [clampForContainer]);

  function beginResize(target: ResizeTarget, clientX: number) {
    dragRef.current = {
      target,
      startX: clientX,
      startLeft: layout.leftWidth,
      startRight: layout.rightWidth,
    };
    setActiveTarget(target);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function resizeByKeyboard(target: ResizeTarget, delta: number) {
    setLayout(
      clampForContainer({
        leftWidth: target === "left" ? layout.leftWidth + delta : layout.leftWidth,
        rightWidth: target === "right" ? layout.rightWidth - delta : layout.rightWidth,
      })
    );
  }

  function handleKeyDown(target: ResizeTarget, event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      resizeByKeyboard(target, -24);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      resizeByKeyboard(target, 24);
    }
    if (event.key === "Home") {
      event.preventDefault();
      setLayout(clampForContainer(DEFAULT_DESKTOP_PANEL_LAYOUT));
    }
  }

  function resizeHandle(target: ResizeTarget, label: string) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuenow={target === "left" ? layout.leftWidth : layout.rightWidth}
        className={`group relative z-10 h-full w-2 shrink-0 cursor-col-resize bg-transparent outline-none transition hover:bg-[var(--color-accent-soft)] focus-visible:bg-[var(--color-accent-soft)] ${
          activeTarget === target ? "bg-[var(--color-accent-soft)]" : ""
        }`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          beginResize(target, event.clientX);
        }}
        onKeyDown={(event) => handleKeyDown(target, event)}
        role="separator"
      >
        <span
          className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-200 transition group-hover:bg-[var(--color-accent-ring)] group-focus-visible:bg-[var(--color-accent-ring)] ${
            activeTarget === target ? "bg-[var(--color-accent)]" : ""
          }`}
        />
      </button>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full min-w-0 flex-1 overflow-hidden bg-slate-50">
      <div className="h-full min-w-0 shrink-0 overflow-hidden" style={{ width: layout.leftWidth }}>
        {left}
      </div>
      {resizeHandle("left", "Resize inbox list")}
      <main className="min-w-0 flex-1 overflow-hidden bg-slate-50">{main}</main>
      {right && (
        <>
          {resizeHandle("right", "Resize context panel")}
          <aside
            className="h-full min-w-0 shrink-0 overflow-y-auto bg-slate-50 p-3"
            style={{ width: layout.rightWidth }}
          >
            {right}
          </aside>
        </>
      )}
    </div>
  );
}
