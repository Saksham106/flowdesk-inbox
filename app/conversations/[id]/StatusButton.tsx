"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function StatusButton({
  conversationId,
  currentStatus,
}: {
  conversationId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const isClosed = currentStatus === "closed";
  const nextStatus = isClosed ? "needs_reply" : "closed";

  async function onClick() {
    setLoading(true);
    await fetch(`/api/conversations/${conversationId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? "..." : isClosed ? "Reopen" : "Close"}
    </button>
  );
}
