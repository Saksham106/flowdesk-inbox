import { clampAutomationLevel } from "@/lib/agent/automation-level"

/**
 * Short human label for each automation level, used in the control-room status
 * line ("Level 3 (creates drafts)"). Mirrors the trust-ladder table in
 * `lib/agent/automation-level.ts` / docs/product-direction.md.
 */
const LEVEL_LABELS: Record<number, string> = {
  0: "read-only",
  1: "suggests only",
  2: "organizes Gmail",
  3: "creates drafts",
  4: "tidies your inbox",
  5: "sends approved replies",
}

export function automationLevelLabel(level: number): string {
  return LEVEL_LABELS[clampAutomationLevel(level)] ?? LEVEL_LABELS[0]
}

/**
 * Builds the control-room status line: what the agent is doing right now and
 * how much is waiting on the user. Pure so it can be unit-tested and rendered
 * on the server without a client boundary.
 *
 * - Before any Gmail account is connected, saying "FlowDesk is working in
 *   your Gmail" is simply false — a brand-new signup would see a confident
 *   claim about something that hasn't happened yet, with no indication of
 *   what to do next. Returns an honest, action-oriented line instead.
 * - Once connected: always states the automation level and its plain-English
 *   meaning, and appends the pending-review count only when there is
 *   something to review, so an all-clear control room doesn't show a
 *   distracting "0 waiting".
 */
export function buildControlRoomStatus(input: {
  level: number
  pendingReview: number
  hasGmail: boolean
}): string {
  if (!input.hasGmail) {
    return "Connect Gmail to get FlowDesk working — takes about a minute."
  }

  const level = clampAutomationLevel(input.level)
  const base = `FlowDesk is working in your Gmail · Level ${level} (${automationLevelLabel(level)})`

  if (input.pendingReview > 0) {
    const noun = input.pendingReview === 1 ? "item" : "items"
    return `${base} · ${input.pendingReview} ${noun} waiting your review`
  }
  return base
}
