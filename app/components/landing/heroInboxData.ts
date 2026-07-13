// Pure data + state functions for the hero inbox demo. Everything the
// animation shows is a deterministic function of one progress value p ∈ [0,1]
// so the beam can scrub it forwards and backwards.

export type ChipKind =
  | "handled"
  | "newsletter"
  | "readLater"
  | "needsAction"
  | "notification"
  | "marketing"
  | "autodrafted";

export interface HeroRow {
  id: string;
  sender: string;
  chips: ChipKind[];
  subject: string;
  snippet: string;
  date: string;
  /** p threshold at which this row gets its chips / loses unread bold */
  labelAt: number;
  /** stays visually bold even after being handled (mirrors real screenshot) */
  boldAfter?: boolean;
  /** archived by the transformation; exists as junk in the before state */
  junk?: boolean;
  /** p threshold at which a junk row archives */
  archiveAt?: number;
  /** the finale row whose reply snippet types itself out */
  draft?: boolean;
  /** before-state overrides (the draft row reads as a plain unanswered email) */
  beforeSender?: string;
  beforeSubject?: string;
  beforeSnippet?: string;
}

export interface RowState {
  chipsVisible: boolean;
  archived: boolean;
  bold: boolean;
  typedChars: number;
}

export const TIMELINE = {
  labelStart: 0.08,
  labelEnd: 0.55,
  archiveStart: 0.4,
  archiveEnd: 0.68,
  typeStart: 0.68,
  typeEnd: 0.88,
  restAt: 0.92,
  sweepMs: 5200,
} as const;

export const CHIP_STYLES: Record<ChipKind, { label: string; bg: string; fg: string }> = {
  handled: { label: "Handled", bg: "#d5cbbb", fg: "#3b3428" },
  newsletter: { label: "Newsletter", bg: "#f0e096", fg: "#4a4014" },
  readLater: { label: "Read Later", bg: "#f3c2d7", fg: "#57182f" },
  needsAction: { label: "Needs Action", bg: "#f5c26b", fg: "#4d340a" },
  notification: { label: "Notification", bg: "#a5d3e8", fg: "#123a4c" },
  marketing: { label: "Marketing", bg: "#f0a49b", fg: "#521a13" },
  autodrafted: { label: "Autodrafted", bg: "#d4c3f5", fg: "#31205e" },
};

type RawRow = Omit<HeroRow, "labelAt" | "archiveAt">;

// Rows mirror public/images/landing/product-screenshot.png; junk rows are
// invented senders that only exist in the "before" state.
const RAW_ROWS: RawRow[] = [
  {
    id: "shortform-1",
    sender: "Shortform Articles",
    chips: ["newsletter", "readLater"],
    subject: "Author Michael Lews plumbs the depths of greed",
    snippet: "Plus, check out the most popular guides this week",
    date: "Jul 10",
    boldAfter: true,
  },
  {
    id: "google-play",
    sender: "Google Play",
    chips: ["handled"],
    subject: "Updates to Google Play Terms of Service",
    snippet: "On July 29, 2026, we're making some changes t",
    date: "Jul 10",
  },
  {
    id: "deals-daily",
    sender: "DealsDaily",
    chips: [],
    subject: "🔥 FINAL HOURS: 80% off EVERYTHING must go",
    snippet: "Don't miss out!!! Your cart is waiting and prices like",
    date: "Jul 10",
    junk: true,
  },
  {
    id: "insight-academy",
    sender: "Insight Academy",
    chips: ["handled", "needsAction", "notification"],
    subject: "Reset Your Password",
    snippet: "Reset Your Password Hi, Click the button below",
    date: "Jul 10",
  },
  {
    id: "supabase",
    sender: "Supabase",
    chips: ["handled", "notification"],
    subject: "Your Supabase Project insight is running out of Disk IO Budget",
    snippet: "Hey there, We",
    date: "Jul 9",
  },
  {
    id: "crypto-pulse",
    sender: "CryptoPulse Weekly",
    chips: [],
    subject: "🚀 10 coins about to EXPLODE (number 7 will shock you)",
    snippet: "Unsubscribe? Never! Here's what the whales are buying",
    date: "Jul 9",
    junk: true,
  },
  {
    id: "uber",
    sender: "Uber",
    chips: ["handled", "marketing"],
    subject: "Get up to 50% OFF on your first Metro ticket",
    snippet: "Uber One app, full journey —",
    date: "Jul 9",
    boldAfter: true,
  },
  {
    id: "quora",
    sender: "Quora Digest",
    chips: ["newsletter", "readLater"],
    subject: "Is Vietnam safer than China?",
    snippet: "As a Chinese who has lived in Vietnam, let m",
    date: "Jul 9",
    boldAfter: true,
  },
  {
    id: "shivansh-draft",
    sender: "Shivansh, Draft 2",
    chips: ["autodrafted"],
    subject: "Re: Quick sync this week?",
    snippet:
      "Hi Shivansh — Thursday 2pm works great. I've attached the numbers you asked about.",
    date: "Jul 8",
    draft: true,
    beforeSender: "Shivansh Goel",
    beforeSubject: "Quick sync this week?",
    beforeSnippet: "Did you get a chance to look at the numbers? Still",
  },
  {
    id: "reddit",
    sender: "Reddit",
    chips: ["handled", "needsAction", "notification"],
    subject: "Reddit password reset",
    snippet: "Hi there, Thanks for requesting a pass",
    date: "Jul 8",
    boldAfter: true,
  },
  {
    id: "supersaver",
    sender: "SuperSaver Club",
    chips: [],
    subject: "You've been SELECTED ⭐ claim your reward now",
    snippet: "Congratulations! You are one of 10,000 lucky members",
    date: "Jul 8",
    junk: true,
  },
  {
    id: "cloudflare-invoice",
    sender: "Cloudflare",
    chips: ["handled", "notification"],
    subject: "Your invoice is available",
    snippet: "Invoice IN-70737729: $10.46 due July 7, 2026 Cloudfl",
    date: "Jul 8",
  },
  {
    id: "claude-team",
    sender: "Claude Team",
    chips: ["handled", "notification"],
    subject: "Fable 5 access is extended through Sunday",
    snippet: "Through Sunday, July 12, then us",
    date: "Jul 8",
  },
  {
    id: "marc",
    sender: "Marc at Master.dev",
    chips: ["newsletter", "readLater"],
    subject: "July #39: We're Now Master.dev, Fable 5 Returns & DevTools Goes Agen",
    snippet: "The big rename, plus everything we shipped",
    date: "Jul 7",
    boldAfter: true,
  },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 0 before start, 1 after end, linear in between */
export const spanProgress = (p: number, start: number, end: number) =>
  clamp01((p - start) / (end - start));

const junkCount = RAW_ROWS.filter((r) => r.junk).length;
let junkSeen = 0;

export const HERO_ROWS: HeroRow[] = RAW_ROWS.map((row, i) => {
  const labelSpan = TIMELINE.labelEnd - TIMELINE.labelStart;
  const labelAt = row.draft
    ? TIMELINE.typeStart // draft chip pops when typing starts
    : TIMELINE.labelStart + (i / (RAW_ROWS.length - 1)) * labelSpan;
  let archiveAt: number | undefined;
  if (row.junk) {
    const archiveSpan = TIMELINE.archiveEnd - TIMELINE.archiveStart;
    archiveAt =
      TIMELINE.archiveStart + (junkSeen / Math.max(1, junkCount - 1)) * archiveSpan;
    junkSeen += 1;
  }
  return { ...row, labelAt, archiveAt };
});

export function rowStateAt(p: number, row: HeroRow): RowState {
  const labeled = p >= row.labelAt;
  const archived = !!row.junk && row.archiveAt !== undefined && p >= row.archiveAt;
  const typedChars = row.draft
    ? Math.round(
        spanProgress(p, TIMELINE.typeStart, TIMELINE.typeEnd) * row.snippet.length
      )
    : 0;
  return {
    chipsVisible: labeled && !archived && row.chips.length > 0,
    archived,
    bold: labeled ? !!row.boldAfter : true,
    typedChars,
  };
}

const BEFORE_TOTAL = 5918;
const AFTER_TOTAL = 12;
const BEFORE_PAGE_END = 50;

export function counterAt(p: number): string {
  const t = spanProgress(p, TIMELINE.archiveStart, TIMELINE.archiveEnd);
  const total = Math.round(BEFORE_TOTAL + (AFTER_TOTAL - BEFORE_TOTAL) * t);
  const end = Math.round(BEFORE_PAGE_END + (AFTER_TOTAL - BEFORE_PAGE_END) * t);
  return `1–${end.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
}
