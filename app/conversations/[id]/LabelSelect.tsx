"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const;

export default function LabelSelect({
  conversationId,
  currentLabel,
}: {
  conversationId: string;
  currentLabel: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onChange(value: string) {
    setSaving(true);
    await fetch(`/api/conversations/${conversationId}/label`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: value === "none" ? null : value }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <select
      value={currentLabel ?? "none"}
      onChange={(e) => onChange(e.target.value)}
      disabled={saving}
      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none disabled:opacity-50"
    >
      <option value="none">No label</option>
      {LABELS.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}
