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

const SENSITIVE_PATTERN =
  /\b(legal|lawsuit|attorney|immigration|tax|medical|doctor|diagnosis|angry|furious|refund|dispute|contract|hr|employment|breakup|divorce|owed|collections|overdue)\b/i
const LEAD_PATTERN =
  /\b(pricing|price|charge|cost|quote|demo|available|availability|book|setup|interested|can you help|do you work with)\b/i
const FYI_PATTERN = /\b(fyi|newsletter|for your records|no action|all set|thanks, all set)\b/i
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

function bodyText(conversation: CommandCenterInputConversation): string {
  return conversation.messages.map((message) => message.body).join("\n")
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
  const latest = latestMessage(conversation)
  return (
    conversation.status === "closed" ||
    (conversation.status !== "needs_reply" &&
      !hasPendingApproval(conversation) &&
      !isSensitive(conversation) &&
      latest?.direction === "inbound" &&
      FYI_PATTERN.test(latest.body))
  )
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
  const safelyIgnored = isSafelyIgnorable(conversation)
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
  } else if (opportunity) {
    state = "opportunity"
    priority = "high"
    reason = "Potential revenue or booking opportunity."
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
  } else if (safelyIgnored) {
    state = "fyi_only"
    priority = "none"
    reason = "FYI only."
    nextAction = "No action needed."
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
    .map((message) => message.body)
    .slice(-3)
  const state = analyzeConversationForCommandCenter(conversation, now)
  const intent = typeof meta.intent === "string" ? meta.intent : null
  const label = typeof meta.suggestedLabel === "string" ? meta.suggestedLabel : conversation.label

  return {
    name: displayName(conversation),
    lastConversationSummary: intent
      ? `Last classified as ${intent}.`
      : latest
        ? latest.body.slice(0, 160)
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
  return (
    priorityScore[conversation.priority] +
    (conversation.opportunity ? 25 : 0) +
    (conversation.sensitive ? 20 : 0) +
    (conversation.needsReply ? 10 : 0)
  )
}
