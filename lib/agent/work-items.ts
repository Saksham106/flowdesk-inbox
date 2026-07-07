import {
  analyzeConversationForCommandCenter,
  type CommandCenterInputConversation,
  type CommandCenterPriority,
  type CommandCenterState,
} from "@/lib/agent/command-center"
import { resolveAccountMode, type AccountMode } from "@/lib/account-mode"

type MessageDirection = "inbound" | "outbound" | string

export type WorkItemConversationInput = Omit<
  CommandCenterInputConversation,
  "messages"
> & {
  tenantId: string
  messages: Array<{
    id: string
    direction: MessageDirection
    body: string
    createdAt: Date
  }>
}

export type ConversationStateDraft = {
  conversationId: string
  state: CommandCenterState
  priority: CommandCenterPriority
  reason: string
  nextAction: string
  confidence: number
  source: "deterministic"
  metadata: Record<string, unknown>
}

export type InboxTaskDraft = {
  conversationId: string
  title: string
  status: "open"
  dueAt: Date | null
  source: "deterministic"
  sourceMessageId: string | null
  deterministicKey: string
  metadata: Record<string, unknown>
}

export type LeadDraft = {
  conversationId: string
  name: string
  company: string | null
  need: string
  urgency: "low" | "medium" | "high"
  budgetClue: string | null
  contactInfo: string | null
  nextAction: string
  score: number
  stage: "new"
  source: "deterministic"
  metadata: Record<string, unknown>
}

export type WorkItemSummary = {
  state: ConversationStateDraft
  tasks: InboxTaskDraft[]
  lead: LeadDraft | null
}

export type WorkItemSummaryOptions = {
  accountType?: unknown
}

const FYI_PATTERN = /\b(fyi|newsletter|for your records|no action needed|all set)\b/i
const SEND_PATTERN = /\b(send|share|provide|forward)\b/i
const CONTRACT_PATTERN = /\b(contract|proposal|form|evidence|document|paperwork)\b/i
const DEADLINE_PATTERN = /\b(by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|due\s+[a-z]+\s+\d{1,2})\b/i
const PAYMENT_PATTERN = /\b(invoice|payment|pay|paid|renewal|bill|due|overdue)\b/i
const LEAD_PATTERN =
  /\b(pricing|price|charge|cost|quote|demo|book|setup|interested|available|can you help|do you work with)\b/i
const COMPANY_PATTERN = /\b([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,3})\s+(Dental|Clinic|Studio|Agency|Salon|Spa|Tutoring|LLC|Inc)\b/
const MONEY_PATTERN = /\$\d+(?:,\d{3})*(?:\.\d{2})?/
const BUDGET_PATTERN = /\b(budget|price|pricing|cost|charge|quote)\b/i
const HIGH_URGENCY_PATTERN = /\b(today|tomorrow|by friday|by monday|this week|next week|urgent|asap|demo|book)\b/i

export function buildConversationStateDraft(
  conversation: WorkItemConversationInput,
  now = new Date(),
  options: WorkItemSummaryOptions = {}
): ConversationStateDraft {
  const accountMode = resolveAccountMode(options.accountType ?? "personal")
  const analysis = analyzeConversationForCommandCenter(conversation, now, accountMode)

  return {
    conversationId: conversation.id,
    state: analysis.state,
    priority: analysis.priority,
    reason: analysis.reason,
    nextAction: analysis.nextAction,
    confidence: confidenceForPriority(analysis.priority),
    source: "deterministic",
    metadata: {
      sensitive: analysis.sensitive,
      safelyIgnored: analysis.safelyIgnored,
      approvalReason: analysis.approvalReason,
      label: analysis.label,
    },
  }
}

export function extractInboxTaskDrafts(
  conversation: WorkItemConversationInput,
  now = new Date()
): InboxTaskDraft[] {
  const tasks: InboxTaskDraft[] = []

  for (const message of conversation.messages) {
    if (message.direction !== "inbound" || FYI_PATTERN.test(message.body)) {
      continue
    }

    const body = message.body
    const dueAt = extractDueDate(body, now)
    const amount = body.match(MONEY_PATTERN)?.[0] ?? null

    if (PAYMENT_PATTERN.test(body) && (amount || /\b(invoice|payment|renewal|bill)\b/i.test(body))) {
      tasks.push({
        conversationId: conversation.id,
        title: "Pay invoice or renewal",
        status: "open",
        dueAt,
        source: "deterministic",
        sourceMessageId: message.id,
        deterministicKey: `${conversation.id}:${message.id}:payment`,
        metadata: { amount, trigger: "payment" },
      })
      continue
    }

    if (SEND_PATTERN.test(body) || CONTRACT_PATTERN.test(body)) {
      tasks.push({
        conversationId: conversation.id,
        title: buildSendTaskTitle(body),
        status: "open",
        dueAt,
        source: "deterministic",
        sourceMessageId: message.id,
        deterministicKey: `${conversation.id}:${message.id}:send`,
        metadata: { trigger: "promise_or_deadline" },
      })
      continue
    }

    if (DEADLINE_PATTERN.test(body)) {
      tasks.push({
        conversationId: conversation.id,
        title: "Reply before deadline",
        status: "open",
        dueAt,
        source: "deterministic",
        sourceMessageId: message.id,
        deterministicKey: `${conversation.id}:${message.id}:deadline`,
        metadata: { trigger: "deadline" },
      })
    }
  }

  return dedupeByKey(tasks)
}

export function extractLeadDraft(
  conversation: WorkItemConversationInput
): LeadDraft | null {
  const text = conversation.messages.map((message) => message.body).join("\n")

  if (FYI_PATTERN.test(text) || (conversation.label !== "Lead" && !LEAD_PATTERN.test(text))) {
    return null
  }

  const company = extractCompany(text)
  const urgency: LeadDraft["urgency"] = HIGH_URGENCY_PATTERN.test(text) ? "high" : "medium"
  const budgetClue = BUDGET_PATTERN.test(text) ? "Budget mentioned" : null
  const score = Math.min(
    100,
    55 +
      (conversation.label === "Lead" ? 15 : 0) +
      (company ? 10 : 0) +
      (budgetClue ? 10 : 0) +
      (urgency === "high" ? 10 : 0)
  )

  return {
    conversationId: conversation.id,
    name: conversation.contact?.name ?? conversation.externalThreadId,
    company,
    need: "Asked about setup, pricing, or booking.",
    urgency,
    budgetClue,
    contactInfo: conversation.contact?.phoneE164 ?? conversation.externalThreadId,
    nextAction: "Draft a reply and ask for the next qualifying detail.",
    score,
    stage: "new",
    source: "deterministic",
    metadata: {
      label: conversation.label,
      matchedLeadLanguage: LEAD_PATTERN.test(text),
    },
  }
}

export function summarizeWorkItems(
  conversation: WorkItemConversationInput,
  now = new Date(),
  options: WorkItemSummaryOptions = {}
): WorkItemSummary {
  const accountMode: AccountMode = resolveAccountMode(options.accountType ?? "personal")
  return {
    state: buildConversationStateDraft(conversation, now, { accountType: accountMode }),
    tasks: extractInboxTaskDrafts(conversation, now),
    lead: accountMode === "business" ? extractLeadDraft(conversation) : null,
  }
}

function confidenceForPriority(priority: CommandCenterPriority): number {
  const confidence: Record<CommandCenterPriority, number> = {
    urgent: 0.85,
    high: 0.75,
    medium: 0.65,
    low: 0.55,
    none: 0.5,
  }
  return confidence[priority]
}

function buildSendTaskTitle(body: string): string {
  const lower = body.toLowerCase()
  if (lower.includes("contract")) return "Send contract"
  if (lower.includes("proposal")) return "Send proposal"
  if (lower.includes("form")) return "Complete or send form"
  if (lower.includes("evidence")) return "Send evidence"
  if (lower.includes("notes")) return "Send the notes"
  return "Send requested information"
}

function extractCompany(text: string): string | null {
  const match = text.match(COMPANY_PATTERN)
  if (!match) return null
  return `${match[1]} ${match[2]}`.trim()
}

function extractDueDate(text: string, now: Date): Date | null {
  const lower = text.toLowerCase()

  if (lower.includes("tomorrow")) {
    return atLocalBusinessClose(addDays(now, 1))
  }

  const weekdayMatch = lower.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)
  if (weekdayMatch?.[1]) {
    return atLocalBusinessClose(nextWeekday(now, weekdayMatch[1]))
  }

  const monthDayMatch = text.match(/\b(?:due\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i)
  if (monthDayMatch?.[1] && monthDayMatch[2]) {
    const month = monthIndex(monthDayMatch[1])
    const day = Number(monthDayMatch[2])
    if (month >= 0 && day >= 1 && day <= 31) {
      const candidate = new Date(Date.UTC(now.getUTCFullYear(), month, day, 16, 0, 0, 0))
      if (candidate.getTime() < now.getTime()) {
        candidate.setUTCFullYear(candidate.getUTCFullYear() + 1)
      }
      return candidate
    }
  }

  return null
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function atLocalBusinessClose(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 16, 0, 0, 0))
}

function nextWeekday(now: Date, weekday: string): Date {
  const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(weekday)
  const current = now.getUTCDay()
  const delta = (target - current + 7) % 7 || 7
  return addDays(now, delta)
}

function monthIndex(month: string): number {
  return [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ].findIndex((prefix) => month.toLowerCase().startsWith(prefix))
}

function dedupeByKey(tasks: InboxTaskDraft[]): InboxTaskDraft[] {
  return Array.from(new Map(tasks.map((task) => [task.deterministicKey, task])).values())
}
