export function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    needs_reply: { label: "Needs Reply", className: "bg-red-100 text-red-700" },
    in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-700" },
    closed: { label: "Closed", className: "bg-slate-100 text-slate-500" },
  };
  const c = config[status] ?? config.needs_reply;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.className}`}
    >
      {c.label}
    </span>
  );
}

const LABEL_COLORS: Record<string, string> = {
  Lead: "bg-blue-100 text-blue-700",
  Reschedule: "bg-purple-100 text-purple-700",
  Pricing: "bg-green-100 text-green-700",
  Complaint: "bg-orange-100 text-orange-700",
};

export function LabelBadge({ label }: { label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${LABEL_COLORS[label] ?? "bg-slate-100 text-slate-500"}`}
    >
      {label}
    </span>
  );
}
