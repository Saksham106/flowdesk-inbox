export function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    needs_reply: { label: "Needs Reply", className: "bg-red-100 text-red-700" },
    draft_ready: { label: "Draft Ready", className: "bg-blue-100 text-blue-700" },
    waiting_on:  { label: "Waiting On",  className: "bg-indigo-100 text-indigo-700" },
    read_later:  { label: "Read Later",  className: "bg-violet-100 text-violet-700" },
    done:        { label: "Done",        className: "bg-slate-100 text-slate-500" },
    // Legacy DB values — map to display equivalents so old StatusBadge callsites keep working
    in_progress: { label: "Waiting On",  className: "bg-indigo-100 text-indigo-700" },
    closed:      { label: "Done",        className: "bg-slate-100 text-slate-500" },
  }
  const c = config[status] ?? config.needs_reply
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

// Content-type labels mirror the Gmail-native taxonomy in lib/gmail-labels.ts
// (FLOWDESK_GMAIL_LABEL_COLORS) so a conversation reads the same way in the
// app as it does in Gmail. "fyi" (informational-but-uncategorized) folds into
// "Notification" here too, matching EMAIL_TYPE_CONTENT_LABEL server-side.
const CONTENT_TYPE_LABELS: Record<string, { label: string; className: string }> = {
  newsletter: { label: "Newsletter", className: "bg-yellow-100 text-yellow-800" },
  marketing: { label: "Marketing", className: "bg-red-100 text-red-700" },
  notification: { label: "Notification", className: "bg-cyan-100 text-cyan-700" },
  fyi: { label: "Notification", className: "bg-cyan-100 text-cyan-700" },
  calendar: { label: "Calendar", className: "bg-green-100 text-green-700" },
};

export function ContentTypeBadge({ emailType }: { emailType: string | null | undefined }) {
  const config = emailType ? CONTENT_TYPE_LABELS[emailType] : undefined;
  if (!config) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}
