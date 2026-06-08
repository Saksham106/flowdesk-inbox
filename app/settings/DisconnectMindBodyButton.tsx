"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DisconnectMindBodyButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDisconnect() {
    if (!confirm("Disconnect MindBody?")) return;
    setLoading(true);
    await fetch("/api/connectors/mindbody/disconnect", { method: "POST" });
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
