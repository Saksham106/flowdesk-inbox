/**
 * Pure grouping for the Clean Inbox "who's flooding you" view.
 *
 * Turns a flat list of cleanable conversations into per-sender cleanup
 * proposals (count, sample subjects, conversation ids) sorted biggest-first,
 * mirroring the bulk-unsubscribe pattern from the reference email apps. Kept
 * Prisma-free so it can be unit-tested and so the page owns data fetching.
 *
 * Safety is baked in here rather than trusting the caller's query: a
 * conversation is never offered for bulk cleanup if it needs a reply, is being
 * waited on, is flagged important, or is a financial record (receipt/invoice).
 */

export type CleanupCandidate = {
  id: string
  /** Sender email — stored as `contact.phoneE164` in this codebase. */
  senderEmail: string | null
  senderName: string | null
  subject: string | null
  emailType: string | null
  attentionCategory: string | null
  status: string
  userState: string | null
  hasUnsubscribe: boolean
  lastReceivedAt: Date
}

export type SenderCleanupGroup = {
  senderEmail: string
  senderName: string
  domain: string
  count: number
  sampleSubjects: string[]
  conversationIds: string[]
  hasUnsubscribe: boolean
  lastReceivedAt: Date
}

const PROTECTED_ATTENTION = new Set(["needs_reply", "review_soon", "waiting_on", "important"])
const PROTECTED_USER_STATE = new Set(["needs_reply", "waiting_on"])
const PROTECTED_EMAIL_TYPE = new Set(["receipt", "invoice", "personal"])
const MAX_SAMPLE_SUBJECTS = 3

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(raw: string | null): string | null {
  if (!raw) return null
  const email = raw.trim().toLowerCase()
  return EMAIL_PATTERN.test(email) ? email : null
}

/** A conversation the agent must never bulk-archive without an explicit choice. */
function isProtected(c: CleanupCandidate): boolean {
  if (c.status === "needs_reply") return true
  if (c.userState && PROTECTED_USER_STATE.has(c.userState)) return true
  if (c.attentionCategory && PROTECTED_ATTENTION.has(c.attentionCategory)) return true
  if (c.emailType && PROTECTED_EMAIL_TYPE.has(c.emailType)) return true
  return false
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@")
  return at >= 0 ? email.slice(at + 1) : email
}

type Mutable = {
  senderEmail: string
  senderName: string
  domain: string
  conversationIds: string[]
  sampleSubjects: string[]
  hasUnsubscribe: boolean
  lastReceivedAt: Date
}

export function groupCleanupBySender(candidates: CleanupCandidate[]): SenderCleanupGroup[] {
  const groups = new Map<string, Mutable>()

  for (const c of candidates) {
    if (isProtected(c)) continue
    const email = normalizeEmail(c.senderEmail)
    if (!email) continue

    let group = groups.get(email)
    if (!group) {
      group = {
        senderEmail: email,
        senderName: c.senderName?.trim() || email,
        domain: domainOf(email),
        conversationIds: [],
        sampleSubjects: [],
        hasUnsubscribe: false,
        lastReceivedAt: c.lastReceivedAt,
      }
      groups.set(email, group)
    }

    group.conversationIds.push(c.id)
    group.hasUnsubscribe = group.hasUnsubscribe || c.hasUnsubscribe
    if (c.lastReceivedAt > group.lastReceivedAt) group.lastReceivedAt = c.lastReceivedAt

    const subject = c.subject?.trim()
    if (
      subject &&
      group.sampleSubjects.length < MAX_SAMPLE_SUBJECTS &&
      !group.sampleSubjects.includes(subject)
    ) {
      group.sampleSubjects.push(subject)
    }
  }

  return [...groups.values()]
    .map((g) => ({ ...g, count: g.conversationIds.length }))
    .sort((a, b) => b.count - a.count || b.lastReceivedAt.getTime() - a.lastReceivedAt.getTime())
}
