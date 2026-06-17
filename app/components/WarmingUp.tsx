"use client";

import { useEffect } from "react";

export default function WarmingUp() {
  useEffect(() => {
    const t = setTimeout(() => window.location.reload(), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
        <p className="text-sm font-medium text-slate-700">Warming up…</p>
        <p className="mt-1 text-xs text-slate-400">
          The database is starting up. Refreshing in a moment.
        </p>
      </div>
    </div>
  );
}
