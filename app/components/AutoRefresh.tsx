"use client";

import { useEffect } from "react";

export default function AutoRefresh({ intervalMs = 10000 }: { intervalMs?: number }) {
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetch("/api/inbox/summary", { cache: "no-store" }).catch(() => {})
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);

  return null;
}
