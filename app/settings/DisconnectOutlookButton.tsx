"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DisconnectOutlookButton({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDisconnect() {
    if (!confirm("Disconnect this Outlook account? All synced conversations and messages will be permanently deleted from your inbox.")) return;
    setLoading(true);
    await fetch("/api/connectors/outlook/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleDisconnect}
      disabled={loading}
      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
    >
      {loading ? "Disconnecting..." : "Disconnect"}
    </button>
  );
}
