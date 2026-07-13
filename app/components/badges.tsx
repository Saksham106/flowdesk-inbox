// Badge colors follow the landing page's Gmail-label chip palette (see
// app/components/landing/Features.tsx): muted pastel fills with deep ink text
// — amber for needs-attention, blue for informational, purple for waiting,
// green for handled — instead of saturated Tailwind primaries.
export function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    needs_reply: { label: "Needs Reply", className: "bg-[#f3ead6] text-[#7a5a1e]" },
    draft_ready: { label: "Draft Ready", className: "bg-[#e2eaf4] text-[#39597f]" },
    waiting_on:  { label: "Waiting On",  className: "bg-[#eae5f2] text-[#584b7e]" },
    read_later:  { label: "Read Later",  className: "bg-slate-100 text-slate-600" },
    done:        { label: "Done",        className: "bg-[#e2efe4] text-[#3c6647]" },
    // Legacy DB values — map to display equivalents so old StatusBadge callsites keep working
    in_progress: { label: "Waiting On",  className: "bg-[#eae5f2] text-[#584b7e]" },
    closed:      { label: "Done",        className: "bg-[#e2efe4] text-[#3c6647]" },
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
  Lead: "bg-[#e2eaf4] text-[#39597f]",
  Reschedule: "bg-[#eae5f2] text-[#584b7e]",
  Pricing: "bg-[#e2efe4] text-[#3c6647]",
  Complaint: "bg-[#f3ead6] text-[#7a5a1e]",
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
  newsletter: { label: "Newsletter", className: "bg-[#f3ead6] text-[#7a5a1e]" },
  marketing: { label: "Marketing", className: "bg-[#f2e3e0] text-[#8a4a3d]" },
  notification: { label: "Notification", className: "bg-[#e2eaf4] text-[#39597f]" },
  fyi: { label: "Notification", className: "bg-[#e2eaf4] text-[#39597f]" },
  calendar: { label: "Calendar", className: "bg-[#e2efe4] text-[#3c6647]" },
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
