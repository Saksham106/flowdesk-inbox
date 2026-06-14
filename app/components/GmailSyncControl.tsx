"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type GmailSyncChannel = {
  id: string;
  emailAddress: string | null;
  lastSyncedAt: Date | string | null;
  lastSyncError: string | null;
};

type SyncStatus = {
  type: "success" | "error";
  message: string;
} | null;

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_SYNC_COOLDOWN_MS = 60 * 1000;

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  return `${days}d ago`;
}

export default function GmailSyncControl({
  channels,
  compact = false,
}: {
  channels: GmailSyncChannel[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SyncStatus>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(() => {
    const dates = channels
      .map((channel) => (channel.lastSyncedAt ? new Date(channel.lastSyncedAt) : null))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime());
    return dates[0] ?? null;
  });
  const inFlightRef = useRef(false);
  const lastStartedAtRef = useRef(0);

  const hasChannels = channels.length > 0;
  const initialError = useMemo(
    () => channels.find((channel) => channel.lastSyncError)?.lastSyncError ?? null,
    [channels]
  );
  const displayStatus =
    status ??
    (initialError
      ? {
          type: "error" as const,
          message: initialError,
        }
      : null);

  const runSync = useCallback(
    async (source: "manual" | "auto") => {
      if (!hasChannels || inFlightRef.current) return;
      const now = Date.now();
      if (source === "auto" && now - lastStartedAtRef.current < AUTO_SYNC_COOLDOWN_MS) return;

      inFlightRef.current = true;
      lastStartedAtRef.current = now;
      setLoading(true);
      if (source === "manual") setStatus(null);

      try {
        let totalSynced = 0;
        for (const channel of channels) {
          const res = await fetch("/api/connectors/gmail/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelId: channel.id, incremental: Boolean(lastSyncedAt) }),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string; synced?: number };
          if (!res.ok) {
            throw new Error(data.error ?? "Sync failed");
          }
          totalSynced += typeof data.synced === "number" ? data.synced : 0;
        }

        setLastSyncedAt(new Date());
        setStatus({
          type: "success",
          message: totalSynced === 1 ? "Synced 1 update" : `Synced ${totalSynced} updates`,
        });
        router.refresh();
      } catch (err) {
        setStatus({
          type: "error",
          message: err instanceof Error ? err.message : "Sync failed",
        });
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [channels, hasChannels, lastSyncedAt, router]
  );

  useEffect(() => {
    runSync("auto");
  }, [runSync]);

  useEffect(() => {
    if (!hasChannels) return;

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        runSync("auto");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    const interval = window.setInterval(() => runSync("auto"), AUTO_SYNC_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.clearInterval(interval);
    };
  }, [hasChannels, runSync]);

  if (!hasChannels) {
    return null;
  }

  return (
    <div className={`flex ${compact ? "items-start gap-2" : "flex-col gap-1"}`}>
      <button
        type="button"
        onClick={() => runSync("manual")}
        disabled={loading}
        className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label="Sync Gmail inbox"
      >
        {loading ? "Syncing..." : "Sync"}
      </button>
      <div className={compact ? "min-w-0" : ""}>
        <p className="text-[11px] leading-4 text-slate-400">
          {lastSyncedAt ? `Last synced ${relativeTime(lastSyncedAt)}` : "Not synced yet"}
        </p>
        {displayStatus && (
          <p
            className={`max-w-[220px] truncate text-[11px] leading-4 ${
              displayStatus.type === "error" ? "text-red-600" : "text-emerald-600"
            }`}
            title={displayStatus.message}
          >
            {displayStatus.message}
          </p>
        )}
      </div>
    </div>
  );
}
