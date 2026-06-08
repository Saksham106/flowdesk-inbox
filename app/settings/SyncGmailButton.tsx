"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SyncGmailButton({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/connectors/gmail/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      setResult(`Synced ${data.synced} thread${data.synced === 1 ? "" : "s"}`);
      router.refresh();
    } else {
      setResult("Sync failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleSync}
        disabled={loading}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {loading ? "Syncing..." : "Sync now"}
      </button>
      {result && <span className="text-xs text-slate-500">{result}</span>}
    </div>
  );
}
