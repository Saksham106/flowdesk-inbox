"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const BUSINESS_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const;
const PERSONAL_LABELS: string[] = [];

export default function LabelSelect({
  conversationId,
  currentLabel,
  isPersonal = false,
}: {
  conversationId: string;
  currentLabel: string | null;
  isPersonal?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const labels = isPersonal ? PERSONAL_LABELS : BUSINESS_LABELS;

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
      {labels.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}
