type MessageDirection = "inbound" | "outbound" | string

export type RiskRadarSignal = "deadline_soon" | "final_notice" | "unanswered" | "sensitive"
export type RiskRadarPriority = "urgent" | "high" | "medium"

export type RiskRadarInputConversation = {
  id: string
  externalThreadId: string
  label: string | null
  status: string
  lastMessageAt: Date
  contact: { name: string } | null
  channel: { emailAddress?: string | null; type?: string | null }
  messages: Array<{
    direction: MessageDirection
    body: string
    createdAt: Date
  }>
  draft?: {
    metadataJson?: unknown
  } | null
}

export type RiskRadarItem = {
  conversationId: string
  displayName: string
  href: string
  signal: RiskRadarSignal
  priority: RiskRadarPriority
  reason: string
  nextAction: string
  ageInDays: number
  lastMessageAt: Date
  preview: string
  label: string | null
}

export type RiskRadar = {
  totalRiskyConversations: number
  counts: {
    deadlineSoon: number
    finalNotices: number
    unanswered: number
    sensitive: number
  }
  sections: {
    deadlineSoon: RiskRadarItem[]
    finalNotices: RiskRadarItem[]
    unanswered: RiskRadarItem[]
    sensitive: RiskRadarItem[]
  }
  items: RiskRadarItem[]
}

const SENSITIVE_CATEGORIES: Array<{ category: string; pattern: RegExp }> = [
  {
    category: "legal",
    pattern:
      /\b(legal|lawsuit|sue|suing|attorney|lawyer|litigation|subpoena|deposition|settlement|court|arbitration|breach of contract|cease and desist|liability|indemnif|injunction)\b/i,
  },
  {
    category: "immigration",
    pattern:
      /\b(immigration|visa|green card|uscis|i-140|i-485|i-864|deportation|asylum|refugee|work permit|residency|naturalization|undocumented)\b/i,
  },
  {
    category: "tax",
    pattern:
      /\b(irs|tax (return|audit|lien|levy|debt|evasion)|w-2|1099|owing taxes|back taxes|tax penalty|tax fraud|owe the irs|accountant letter)\b/i,
  },
  {
    category: "medical",
    pattern:
      /\b(diagnosis|medical (condition|record|bill|claim)|doctor'?s (note|order|referral)|cancer|surgery|prescription|hipaa|insurance claim|disability claim|mental health (treatment|diagnosis))\b/i,
  },
  {
    category: "hr",
    pattern:
      /\b(human resources|hr department|termination|fired|laid off|layoff|wrongful (termination|dismissal)|discrimination|workplace harassment|hostile work environment|performance improvement plan|pip)\b/i,
  },
  {
    category: "emotional",
    pattern:
      /\b(divorce|separation|custody|restraining order|domestic (violence|abuse)|grief|bereavement|suicide|self.harm|mental health crisis|breakdown|estranged)\b/i,
  },
  {
    category: "financial",
    pattern:
      /\b(collections?|past due|overdue|debt collector|charged off|repossession|foreclosure|bankruptcy|wage garnishment|refund dispute|chargeback|fraud claim)\b/i,
  },
]

export type SensitiveMatch = { phrase: string; category: string }

export function detectSensitiveMatches(text: string): SensitiveMatch[] {
  const seen = new Set<string>()
  const results: SensitiveMatch[] = []

  for (const { category, pattern } of SENSITIVE_CATEGORIES) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g")
    const matches = text.matchAll(globalPattern)
    for (const match of matches) {
      const phrase = match[0].toLowerCase()
      if (!seen.has(phrase)) {
        seen.add(phrase)
        results.push({ phrase, category })
      }
    }
  }

  return results
}

const NEAR_DEADLINE_PATTERN =
  /\b(today|tomorrow|asap|urgent|by\s+(?:eod|end of day|close of business)|before\s+(?:noon|5|five)|due\s+(?:today|tomorrow))\b/i
const DEADLINE_PATTERN =
  /\b(deadline|due|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|due\s+[a-z]+\s+\d{1,2}|before\s+[a-z]+\s+\d{1,2})\b/i
const FINAL_NOTICE_PATTERN =
  /\b(final notice|last chance|collections?|past due|overdue|shutoff|shut off|suspend(?:ed|ion)?|cancel(?:led|lation)?|terminate(?:d|ion)?|service interruption)\b/i
const SENSITIVE_PATTERN =
  /\b(legal|lawsuit|attorney|immigration|tax|medical|doctor|diagnosis|hr|employment|refund|dispute|contract|collections?|divorce|breakup|angry|furious|harassment|liability)\b/i

const PRIORITY_SCORE: Record<RiskRadarPriority, number> = {
  urgent: 300,
  high: 200,
  medium: 100,
}

export function buildRiskRadar(
  conversations: RiskRadarInputConversation[],
  now = new Date()
): RiskRadar {
  const sections = {
    deadlineSoon: [] as RiskRadarItem[],
    finalNotices: [] as RiskRadarItem[],
    unanswered: [] as RiskRadarItem[],
    sensitive: [] as RiskRadarItem[],
  }

  for (const conversation of conversations) {
    const latest = latestMessage(conversation)
    const latestBody = latest?.body ?? ""
    const allText = bodyText(conversation)

    if (latest?.direction === "inbound" && (NEAR_DEADLINE_PATTERN.test(latestBody) || DEADLINE_PATTERN.test(latestBody))) {
      sections.deadlineSoon.push(
        item(conversation, "deadline_soon", NEAR_DEADLINE_PATTERN.test(latestBody) ? "urgent" : "high", "Near-term deadline language detected.", "Reply or schedule the work before the deadline passes.", now)
      )
    }

    if (FINAL_NOTICE_PATTERN.test(allText)) {
      sections.finalNotices.push(
        item(conversation, "final_notice", "urgent", "Final notice or service interruption language detected.", "Review the notice and respond or pay before service is interrupted.", now)
      )
    }

    const daysWaiting = ageInDays(conversation.lastMessageAt, now)
    if (
      conversation.status !== "closed" &&
      latest?.direction === "inbound" &&
      daysWaiting >= 3
    ) {
      sections.unanswered.push(
        item(conversation, "unanswered", "high", `Inbound thread has waited ${daysWaiting} days without a reply.`, "Reply, close the loop, or mark it closed if no response is needed.", now)
      )
    }

    const sensitiveReason = sensitiveReasonFor(conversation, allText)
    if (sensitiveReason) {
      sections.sensitive.push(
        item(conversation, "sensitive", sensitiveReason.priority, sensitiveReason.reason, "Review carefully before drafting, sending, or promising anything.", now)
      )
    }
  }

  sortItems(sections.deadlineSoon)
  sortItems(sections.finalNotices)
  sortItems(sections.unanswered)
  sortItems(sections.sensitive)

  const items = [
    ...sections.deadlineSoon,
    ...sections.finalNotices,
    ...sections.unanswered,
    ...sections.sensitive,
  ]
  sortItems(items)

  return {
    totalRiskyConversations: new Set(items.map((risk) => risk.conversationId)).size,
    counts: {
      deadlineSoon: sections.deadlineSoon.length,
      finalNotices: sections.finalNotices.length,
      unanswered: sections.unanswered.length,
      sensitive: sections.sensitive.length,
    },
    sections,
    items,
  }
}

function item(
  conversation: RiskRadarInputConversation,
  signal: RiskRadarSignal,
  priority: RiskRadarPriority,
  reason: string,
  nextAction: string,
  now: Date
): RiskRadarItem {
  const latest = latestMessage(conversation)

  return {
    conversationId: conversation.id,
    displayName: conversation.contact?.name ?? conversation.externalThreadId,
    href: `/conversations/${conversation.id}`,
    signal,
    priority,
    reason,
    nextAction,
    ageInDays: ageInDays(conversation.lastMessageAt, now),
    lastMessageAt: conversation.lastMessageAt,
    preview: latest?.body.slice(0, 180) ?? "No messages yet.",
    label: conversation.label,
  }
}

function latestMessage(conversation: RiskRadarInputConversation) {
  return [...conversation.messages].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
}

function bodyText(conversation: RiskRadarInputConversation): string {
  return conversation.messages.map((message) => message.body).join("\n")
}

function metadata(conversation: RiskRadarInputConversation): Record<string, unknown> {
  const value = conversation.draft?.metadataJson
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function sensitiveReasonFor(
  conversation: RiskRadarInputConversation,
  text: string
): { priority: RiskRadarPriority; reason: string } | null {
  const meta = metadata(conversation)
  const escalationReason =
    typeof meta.escalationReason === "string" && meta.escalationReason.trim()
      ? meta.escalationReason.trim()
      : null

  if (escalationReason) return { priority: "urgent", reason: escalationReason }
  if (meta.riskLevel === "high") return { priority: "urgent", reason: "High-risk draft metadata detected." }
  if (conversation.label === "Complaint") return { priority: "high", reason: "Complaint label needs careful handling." }
  if (SENSITIVE_PATTERN.test(text)) return { priority: "high", reason: "Sensitive content language detected." }
  return null
}

function ageInDays(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)))
}

function sortItems(items: RiskRadarItem[]) {
  items.sort((a, b) => {
    const priorityDelta = PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority]
    if (priorityDelta !== 0) return priorityDelta
    return b.ageInDays - a.ageInDays || b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
  })
}
