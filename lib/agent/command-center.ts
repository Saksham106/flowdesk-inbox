type MessageDirection = "inbound" | "outbound" | string

export type CommandCenterState =
  | "needs_reply"
  | "waiting_on_them"
  | "waiting_on_you"
  | "scheduled"
  | "done"
  | "snoozed"
  | "delegated"
  | "risky_urgent"
  | "opportunity"
  | "support"
  | "sales_qualified"
  | "fyi_only"

export type CommandCenterPriority = "urgent" | "high" | "medium" | "low" | "none"

export type CommandCenterInputConversation = {
  id: string
  externalThreadId: string
  label: string | null
  status: string
  lastMessageAt: Date
  contact: { name: string; phoneE164?: string | null } | null
  channel: { emailAddress?: string | null; type?: string | null }
  messages: Array<{
    direction: MessageDirection
    body: string
    createdAt: Date
  }>
  draft?: {
    status?: string | null
    metadataJson?: unknown
  } | null
  agentJobs?: Array<{
    trigger?: string | null
    status?: string | null
    intent?: string | null
    confidence?: number | null
    requiresApproval?: boolean | null
    createdAt?: Date
  }>
  approvalRequests?: Array<{
    status?: string | null
    createdAt?: Date
  }>
  calendarHolds?: Array<{
    status?: string | null
    startAt: Date
    expiresAt: Date
  }>
  lead?: {
    score: number
    scoreExplanation: string | null
    estimatedValue?: number | null
  } | null
  conversationState?: {
    metadataJson?: unknown
  } | null
}

export type CommandCenterConversation = {
  id: string
  displayName: string
  state: CommandCenterState
  priority: CommandCenterPriority
  reason: string
  nextAction: string
  href: string
  lastMessageAt: Date
  label: string | null
  sensitive: boolean
  approvalReason: string | null
  safelyIgnored: boolean
  needsReply: boolean
  opportunity: boolean
  leadScore: number | null
  estimatedValue: number | null
}

export type DailyCommandCenter = {
  headline: string
  droppedBallMessage: string
  counts: {
    needsReply: number
    waitingOnThem: number
    waitingOnYou: number
    meetings: number
    approvals: number
    opportunities: number
    potentialProblems: number
    support: number
    salesQualified: number
    safelyIgnored: number
  }
  topActions: CommandCenterConversation[]
  sections: {
    needsReply: CommandCenterConversation[]
    waitingOnThem: CommandCenterConversation[]
    meetings: CommandCenterConversation[]
    approvals: CommandCenterConversation[]
    opportunities: CommandCenterConversation[]
    potentialProblems: CommandCenterConversation[]
    support: CommandCenterConversation[]
    salesQualified: CommandCenterConversation[]
    safelyIgnored: CommandCenterConversation[]
  }
  conversations: CommandCenterConversation[]
}

export type RelationshipContext = {
  name: string
  lastConversationSummary: string
  openTasks: string[]
  tonePreference: string
  importantDetails: string[]
  pastPromises: string[]
  moneySignals: string[]
  relationshipStatus: string
}

const AUTO_EMAIL_TYPES = new Set(["notification", "newsletter", "marketing"])

const SENSITIVE_PATTERN =
  /\b(legal|lawsuit|attorney|immigration|tax|medical|doctor|diagnosis|angry|furious|refund|dispute|contract|hr|employment|breakup|divorce|owed|collections|overdue)\b/i
const LEAD_PATTERN =
  /\b(pricing|price|charge|cost|quote|demo|available|availability|book|setup|interested|can you help|do you work with)\b/i
const FYI_PATTERN = /\b(fyi|newsletter|for your records|no action|all set|thanks, all set)\b/i
const AUTOMATED_SENDER_PATTERN = /\b(no-?reply|noreply|notifications?|alerts?|do-not-reply|automated)\b/i
const AUTOMATED_BODY_PATTERN =
  /\b(unsubscribe|you'?re receiving this|this is an automated (email|message|notification)|do not reply to this email)\b/i
const MONEY_PATTERN = /\b(pricing|price|charge|cost|quote|budget|invoice|payment|paid|refund|setup fee|contract)\b/i
const PROMISE_PATTERN = /\b(i promised|you promised|we promised|send|follow up|circle back|confirm|provide|share)\b/i

function metadata(conversation: CommandCenterInputConversation): Record<string, unknown> {
  const value = conversation.draft?.metadataJson
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function latestMessage(conversation: CommandCenterInputConversation) {
  return [...conversation.messages].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function plainBody(message: { body: string }): string {
  return /^\s*</.test(message.body) ? stripHtml(message.body) : message.body;
}

function bodyText(conversation: CommandCenterInputConversation): string {
  return conversation.messages.map((message) => plainBody(message)).join("\n")
}

function displayName(conversation: CommandCenterInputConversation): string {
  return conversation.contact?.name ?? conversation.externalThreadId
}

function ageInDays(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000))
}

function hasPendingApproval(conversation: CommandCenterInputConversation): boolean {
  return conversation.approvalRequests?.some((request) => request.status === "pending") ?? false
}

function activeHold(conversation: CommandCenterInputConversation) {
  return conversation.calendarHolds?.find((hold) => hold.status === "held") ?? null
}

function isSensitive(conversation: CommandCenterInputConversation): boolean {
  const meta = metadata(conversation)
  return (
    meta.riskLevel === "high" ||
    typeof meta.escalationReason === "string" ||
    conversation.label === "Complaint" ||
    SENSITIVE_PATTERN.test(bodyText(conversation))
  )
}

function isOpportunity(conversation: CommandCenterInputConversation): boolean {
  const meta = metadata(conversation)
  return (
    conversation.label === "Lead" ||
    meta.suggestedLabel === "Lead" ||
    LEAD_PATTERN.test(bodyText(conversation))
  )
}

function isSafelyIgnorable(conversation: CommandCenterInputConversation): boolean {
  if (isAutoEmail(conversation)) return true
  const latest = latestMessage(conversation)
  if (conversation.status === "closed") return true
  if (hasPendingApproval(conversation) || isSensitive(conversation)) return false
  if (latest?.direction !== "inbound") return false

  const senderEmail = conversation.contact?.phoneE164 ?? ""
  const body = latest.body

  return (
    AUTOMATED_SENDER_PATTERN.test(senderEmail) ||
    AUTOMATED_BODY_PATTERN.test(body) ||
    FYI_PATTERN.test(body)
  )
}

function getEmailType(conversation: CommandCenterInputConversation): string | null {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return null
  const emailType = (state.metadataJson as Record<string, unknown>).emailType
  return typeof emailType === "string" ? emailType : null
}

function isAutoEmail(conversation: CommandCenterInputConversation): boolean {
  const emailType = getEmailType(conversation)
  return emailType !== null && AUTO_EMAIL_TYPES.has(emailType)
}

function isClassifiedSupport(conversation: CommandCenterInputConversation): boolean {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return false
  return (state.metadataJson as Record<string, unknown>).isSupport === true
}

function isChurnRisk(conversation: CommandCenterInputConversation): boolean {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return false
  return (state.metadataJson as Record<string, unknown>).churnRisk === true
}

function isSalesQualified(conversation: CommandCenterInputConversation): boolean {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return false
  return (state.metadataJson as Record<string, unknown>).isSalesLead === true
}

function approvalReason(conversation: CommandCenterInputConversation): string | null {
  const meta = metadata(conversation)
  if (typeof meta.escalationReason === "string" && meta.escalationReason.trim()) {
    return meta.escalationReason.trim()
  }
  if (meta.riskLevel === "high") return "High-risk conversation"
  if (conversation.label === "Complaint") return "Complaint needs careful review"
  if (SENSITIVE_PATTERN.test(bodyText(conversation))) return "Sensitive topic detected"
  if (hasPendingApproval(conversation)) return "Draft is waiting for approval"
  return null
}

export function analyzeConversationForCommandCenter(
  conversation: CommandCenterInputConversation,
  now = new Date()
): CommandCenterConversation {
  const latest = latestMessage(conversation)
  const pendingApproval = hasPendingApproval(conversation)
  const hold = activeHold(conversation)
  const sensitive = isSensitive(conversation)
  const opportunity = isOpportunity(conversation)
  const autoEmail = isAutoEmail(conversation)
  const safelyIgnored = isSafelyIgnorable(conversation)
  const support = isClassifiedSupport(conversation)
  const churnRisk = isChurnRisk(conversation)
  const outboundStale =
    latest?.direction === "outbound" &&
    conversation.status !== "closed" &&
    ageInDays(conversation.lastMessageAt, now) >= 3

  let state: CommandCenterState = "fyi_only"
  let priority: CommandCenterPriority = "none"
  let reason = "Safely ignored for now."
  let nextAction = "No action needed."

  if (sensitive) {
    state = "risky_urgent"
    priority = "urgent"
    reason = approvalReason(conversation) ?? "Sensitive conversation needs review."
    nextAction = "Review carefully before sending anything."
  } else if (autoEmail) {
    const emailType = getEmailType(conversation)
    state = "fyi_only"
    priority = "none"
    if (emailType === "notification") {
      reason = "Automated notification — no reply needed."
      nextAction = "Review only if relevant."
    } else if (emailType === "newsletter") {
      reason = "Newsletter or marketing email."
      nextAction = "Unsubscribe if not relevant."
    } else {
      reason = "Marketing / promotional email."
      nextAction = "No action needed."
    }
  } else if (churnRisk) {
    state = "support"
    priority = "urgent"
    reason = "Churn risk detected — customer may cancel."
    nextAction = "Reply promptly and address the core issue."
  } else if (support) {
    state = "support"
    priority = "high"
    reason = "Customer support request detected."
    nextAction = "Reply using the knowledge base or escalate."
  } else if (hold) {
    state = "scheduled"
    priority = hold.expiresAt.getTime() <= now.getTime() + 24 * 60 * 60 * 1000 ? "high" : "medium"
    reason = "Calendar hold is active."
    nextAction = "Confirm, cancel, or keep the hold fresh."
  } else if (conversation.status === "closed") {
    state = "done"
    priority = "none"
    reason = "Conversation is done."
    nextAction = "No action needed."
  } else if (pendingApproval) {
    state = "waiting_on_you"
    priority = "high"
    reason = "Draft is waiting for your approval."
    nextAction = "Review and approve the draft."
  } else if (isSalesQualified(conversation)) {
    state = "sales_qualified"
    priority = "high"
    reason = "Qualified sales lead detected."
    nextAction = "Follow up to advance the deal."
  } else if (safelyIgnored) {
    state = "fyi_only"
    priority = "none"
    reason = "FYI only."
    nextAction = "No action needed."
  } else if (opportunity) {
    state = "opportunity"
    priority = "high"
    reason = conversation.lead?.scoreExplanation ?? "Potential revenue or booking opportunity."
    nextAction = "Draft a reply and move the opportunity forward."
  } else if (conversation.status === "needs_reply" && latest?.direction !== "outbound") {
    state = "needs_reply"
    priority = "high"
    reason = "Needs your reply."
    nextAction = "Draft a reply."
  } else if (outboundStale) {
    state = "waiting_on_them"
    priority = "medium"
    reason = "You are waiting on them."
    nextAction = "Send a follow-up."
  } else if (latest?.direction === "outbound") {
    state = "waiting_on_them"
    priority = "low"
    reason = "Waiting on their response."
    nextAction = "Check back later."
  }

  return {
    id: conversation.id,
    displayName: displayName(conversation),
    state,
    priority,
    reason,
    nextAction,
    href: `/conversations/${conversation.id}`,
    lastMessageAt: conversation.lastMessageAt,
    label: conversation.label,
    sensitive,
    approvalReason: approvalReason(conversation),
    safelyIgnored: state === "done" || safelyIgnored,
    needsReply: conversation.status === "needs_reply" && !safelyIgnored,
    opportunity,
    leadScore: opportunity && conversation.lead ? conversation.lead.score : null,
    estimatedValue: conversation.lead?.estimatedValue ?? null,
  }
}

export function buildDailyCommandCenter(
  conversations: CommandCenterInputConversation[],
  now = new Date()
): DailyCommandCenter {
  const analyzed = conversations.map((conversation) =>
    analyzeConversationForCommandCenter(conversation, now)
  )
  const approvals = analyzed.filter(
    (conversation) => conversation.state === "waiting_on_you" || conversation.approvalReason
  )
  const topActions = analyzed
    .filter((conversation) => conversation.priority !== "none" && !conversation.safelyIgnored)
    .sort((a, b) => score(b) - score(a) || b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
    .slice(0, 7)

  const importantCount = topActions.length

  return {
    headline:
      importantCount === 0
        ? "Nothing urgent needs your attention today."
        : `Here are the ${importantCount} things that actually matter today.`,
    droppedBallMessage:
      topActions.length === 0 ? "You have 0 dropped balls." : `${topActions.length} open item${topActions.length === 1 ? "" : "s"} to handle.`,
    counts: {
      needsReply: analyzed.filter((conversation) => conversation.needsReply).length,
      waitingOnThem: analyzed.filter((conversation) => conversation.state === "waiting_on_them").length,
      waitingOnYou: analyzed.filter((conversation) => conversation.state === "waiting_on_you").length,
      meetings: analyzed.filter((conversation) => conversation.state === "scheduled").length,
      approvals: approvals.length,
      opportunities: analyzed.filter((conversation) => conversation.opportunity).length,
      potentialProblems: analyzed.filter((conversation) => conversation.sensitive).length,
      support: analyzed.filter((conversation) => conversation.state === "support").length,
      salesQualified: analyzed.filter((conversation) => conversation.state === "sales_qualified").length,
      safelyIgnored: analyzed.filter((conversation) => conversation.safelyIgnored).length,
    },
    topActions,
    sections: {
      needsReply: analyzed.filter((conversation) => conversation.state === "needs_reply"),
      waitingOnThem: analyzed.filter((conversation) => conversation.state === "waiting_on_them"),
      meetings: analyzed.filter((conversation) => conversation.state === "scheduled"),
      approvals,
      opportunities: analyzed.filter((conversation) => conversation.opportunity),
      potentialProblems: analyzed.filter((conversation) => conversation.sensitive),
      support: analyzed.filter((conversation) => conversation.state === "support"),
      salesQualified: analyzed.filter((conversation) => conversation.state === "sales_qualified"),
      safelyIgnored: analyzed.filter((conversation) => conversation.safelyIgnored),
    },
    conversations: analyzed,
  }
}

export function buildRelationshipContext(
  conversation: CommandCenterInputConversation,
  now = new Date()
): RelationshipContext {
  const meta = metadata(conversation)
  const text = bodyText(conversation)
  const latest = latestMessage(conversation)
  const moneySignals = Array.from(
    new Set((text.match(new RegExp(MONEY_PATTERN, "gi")) ?? []).map((item) => item.toLowerCase()))
  )
  const pastPromises = conversation.messages
    .filter((message) => PROMISE_PATTERN.test(message.body))
    .map((message) => plainBody(message).slice(0, 200))
    .slice(-3)
  const state = analyzeConversationForCommandCenter(conversation, now)
  const intent = typeof meta.intent === "string" ? meta.intent : null
  const label = typeof meta.suggestedLabel === "string" ? meta.suggestedLabel : conversation.label

  return {
    name: displayName(conversation),
    lastConversationSummary: intent
      ? `Last classified as ${intent}.`
      : latest
        ? plainBody(latest).slice(0, 160)
        : "No recent conversation summary yet.",
    openTasks: buildOpenTasks(conversation, state, pastPromises),
    tonePreference: "Use a concise, warm, approval-first reply.",
    importantDetails: [
      label ? `Label: ${label}` : null,
      conversation.channel.emailAddress ? `Inbox: ${conversation.channel.emailAddress}` : null,
      latest ? `Last message: ${ageInDays(latest.createdAt, now) === 0 ? "today" : `${ageInDays(latest.createdAt, now)}d ago`}` : null,
    ].filter((item): item is string => Boolean(item)),
    pastPromises,
    moneySignals,
    relationshipStatus: state.opportunity ? "Opportunity" : state.sensitive ? "Sensitive" : state.state === "done" ? "Closed" : "Active",
  }
}

function buildOpenTasks(
  conversation: CommandCenterInputConversation,
  state: CommandCenterConversation,
  pastPromises: string[]
): string[] {
  if (pastPromises.length > 0) {
    return pastPromises.map((promise) => {
      if (/\bsend\b/i.test(promise)) return "Send the promised follow-up."
      if (/\bconfirm\b/i.test(promise)) return "Confirm the open question."
      return "Follow through on the last promise."
    })
  }

  if (state.state === "needs_reply" || state.state === "opportunity") {
    return [state.nextAction]
  }

  if (state.state === "waiting_on_them") {
    return ["Follow up if this still matters today."]
  }

  return []
}

function score(conversation: CommandCenterConversation): number {
  const priorityScore: Record<CommandCenterPriority, number> = {
    urgent: 500,
    high: 400,
    medium: 300,
    low: 200,
    none: 0,
  }
  const revenueBonus = Math.min(Math.floor((conversation.estimatedValue ?? 0) / 200), 50)
  return (
    priorityScore[conversation.priority] +
    (conversation.opportunity ? 25 : 0) +
    (conversation.sensitive ? 20 : 0) +
    (conversation.needsReply ? 10 : 0) +
    (conversation.state === "support" ? 30 : 0) +
    (conversation.state === "sales_qualified" ? 35 : 0) +
    revenueBonus
  )
}
