"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export default function SyncGmailButton({
  channelId,
  lastSyncedAt,
  lastSyncError,
}: {
  channelId: string;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [freshError, setFreshError] = useState<string | null>(null);
  const [freshSyncedAt, setFreshSyncedAt] = useState<Date | null>(null);

  const displayError = freshError ?? lastSyncError;
  const displaySyncedAt = freshSyncedAt ?? lastSyncedAt;

  async function handleSync() {
    setLoading(true);
    setFreshError(null);

    const res = await fetch("/api/connectors/gmail/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, incremental: Boolean(displaySyncedAt) }),
    });

    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      setFreshSyncedAt(new Date());
      router.refresh();
    } else {
      setFreshError(data.error ?? "Sync failed");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          onClick={handleSync}
          disabled={loading}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? "Syncing..." : "Sync now"}
        </button>
      </div>
      {displaySyncedAt && !displayError && (
        <p className="text-xs text-slate-400">
          Synced {relativeTime(new Date(displaySyncedAt))}
        </p>
      )}
      {displayError && (
        <p className="text-xs text-red-500" title={displayError}>
          Sync error — {displayError.length > 40 ? displayError.slice(0, 40) + "…" : displayError}
        </p>
      )}
    </div>
  );
}
