import { resolveAccountMode, type AccountMode } from "@/lib/account-mode"
import { stripHtmlToText } from "@/lib/email-body"

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
  readAt?: Date | null
  gmailUnread?: boolean | null
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

/** Persisted conversation state from the database (ConversationState model) */
export type PersistedCommandCenterState = {
  conversationId: string
  state: CommandCenterState
  priority: CommandCenterPriority
  reason: string
  nextAction: string
  confidence: number
  source: string
  metadataJson: unknown
  updatedAt: Date
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
  needsAction: boolean
  readLater: boolean
  opportunity: boolean
  leadScore: number | null
  estimatedValue: number | null
  emailType: string | null
  isRead: boolean
  action: {
    type: string
    explanation: string
    actionLink?: string
    expirationText?: string
    hasDetectedCode?: boolean
  } | null
}

export type AgentSummary = {
  classifiedLast24h: number
  draftedLast24h: number
  learnedRecentlyUpdated: boolean
}

export type QuietlyHandledBreakdown = {
  newsletter: number
  notification: number
  marketing: number
  other: number
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
    needsAction: number
    readLater: number
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
    needsAction: CommandCenterConversation[]
    readLater: CommandCenterConversation[]
  }
  quietlyHandledBreakdown: QuietlyHandledBreakdown
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

const LEGACY_AUTO_EMAIL_TYPES = new Set(["notification", "newsletter", "marketing"])
const IGNORABLE_ATTENTION_CATEGORIES = new Set(["quiet", "fyi_done"])

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
    meta.attentionCategory === "review_soon" ||
    meta.riskLevel === "high" ||
    typeof meta.escalationReason === "string" ||
    conversation.label === "Complaint" ||
    SENSITIVE_PATTERN.test(bodyText(conversation))
  )
}

function isOpportunity(conversation: CommandCenterInputConversation, accountMode: AccountMode): boolean {
  if (accountMode !== "business") return false
  // Automated/marketing emails are never real opportunities
  if (isAutoEmail(conversation)) return false
  const meta = metadata(conversation)
  return (
    conversation.label === "Lead" ||
    meta.suggestedLabel === "Lead" ||
    LEAD_PATTERN.test(bodyText(conversation))
  )
}

function isSafelyIgnorable(conversation: CommandCenterInputConversation): boolean {
  const attentionCategory = getAttentionCategory(conversation)
  if (attentionCategory && IGNORABLE_ATTENTION_CATEGORIES.has(attentionCategory)) return true
  if (attentionCategory && !IGNORABLE_ATTENTION_CATEGORIES.has(attentionCategory)) return false
  if (isAutoEmail(conversation)) return true
  if (conversation.status === "closed") return true

  const latest = latestMessage(conversation)
  if (latest?.direction !== "inbound") return false

  const senderEmail = conversation.contact?.phoneE164 ?? ""
  const body = latest.body

  // Check automated patterns before the sensitive guard so that marketing emails
  // containing words like "refund", "tax", or "collections" are not misclassified.
  if (
    AUTOMATED_SENDER_PATTERN.test(senderEmail) ||
    AUTOMATED_BODY_PATTERN.test(body) ||
    FYI_PATTERN.test(body)
  ) return true

  if (hasPendingApproval(conversation) || isSensitive(conversation)) return false

  return false
}

function getEmailType(conversation: CommandCenterInputConversation): string | null {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return null
  const emailType = (state.metadataJson as Record<string, unknown>).emailType
  return typeof emailType === "string" ? emailType : null
}

function getAttentionCategory(conversation: CommandCenterInputConversation): string | null {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return null
  const attentionCategory = (state.metadataJson as Record<string, unknown>).attentionCategory
  return typeof attentionCategory === "string" ? attentionCategory : null
}

function getAttentionReason(conversation: CommandCenterInputConversation): string | null {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return null
  const reason = (state.metadataJson as Record<string, unknown>).attentionReason
  return typeof reason === "string" && reason.trim() ? reason.trim() : null
}

function getActionMetadata(conversation: CommandCenterInputConversation): CommandCenterConversation["action"] {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return null
  const action = (state.metadataJson as Record<string, unknown>).action
  if (!action || typeof action !== "object" || Array.isArray(action)) return null
  const record = action as Record<string, unknown>
  const type = typeof record.type === "string" ? record.type : null
  const explanation = typeof record.explanation === "string" ? record.explanation : null
  if (!type || !explanation) return null
  return {
    type,
    explanation,
    ...(typeof record.actionLink === "string" ? { actionLink: record.actionLink } : {}),
    ...(typeof record.expirationText === "string" ? { expirationText: record.expirationText } : {}),
    ...(typeof record.hasDetectedCode === "boolean" ? { hasDetectedCode: record.hasDetectedCode } : {}),
  }
}

function isAutoEmail(conversation: CommandCenterInputConversation): boolean {
  const attentionCategory = getAttentionCategory(conversation)
  if (attentionCategory) return IGNORABLE_ATTENTION_CATEGORIES.has(attentionCategory)
  const emailType = getEmailType(conversation)
  return emailType !== null && LEGACY_AUTO_EMAIL_TYPES.has(emailType)
}

function isClassifiedSupport(conversation: CommandCenterInputConversation, accountMode: AccountMode): boolean {
  if (accountMode !== "business") return false
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return false
  return (state.metadataJson as Record<string, unknown>).isSupport === true
}

function isChurnRisk(conversation: CommandCenterInputConversation): boolean {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return false
  return (state.metadataJson as Record<string, unknown>).churnRisk === true
}

function isSalesQualified(conversation: CommandCenterInputConversation, accountMode: AccountMode): boolean {
  if (accountMode !== "business") return false
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
  now = new Date(),
  accountType?: unknown
): CommandCenterConversation {
  const accountMode = resolveAccountMode(accountType ?? "business")
  const latest = latestMessage(conversation)
  const pendingApproval = hasPendingApproval(conversation)
  const hold = activeHold(conversation)
  const sensitive = isSensitive(conversation)
  const opportunity = isOpportunity(conversation, accountMode)
  const autoEmail = isAutoEmail(conversation)
  const attentionCategory = getAttentionCategory(conversation)
  const attentionReason = getAttentionReason(conversation)
  const safelyIgnored = isSafelyIgnorable(conversation)
  const support = isClassifiedSupport(conversation, accountMode)
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
    priority = attentionCategory === "review_soon" ? "high" : "urgent"
    reason = attentionReason ?? approvalReason(conversation) ?? "Sensitive conversation needs review."
    nextAction = "Review carefully before sending anything."
  } else if (attentionCategory === "needs_action") {
    state = "waiting_on_you"
    priority = "high"
    reason = attentionReason ?? "This email requires an action, but not necessarily a reply."
    nextAction = "Complete the requested action."
  } else if (attentionCategory === "read_later") {
    state = "fyi_only"
    priority = "low"
    reason = attentionReason ?? "Useful update to read later."
    nextAction = "Read later if relevant."
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
  } else if (isSalesQualified(conversation, accountMode)) {
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
    needsReply: conversation.status === "needs_reply" && !safelyIgnored && (!attentionCategory || attentionCategory === "needs_reply"),
    needsAction: attentionCategory === "needs_action",
    readLater: attentionCategory === "read_later",
    opportunity,
    leadScore: opportunity && conversation.lead ? conversation.lead.score : null,
    estimatedValue: conversation.lead?.estimatedValue ?? null,
    emailType: getEmailType(conversation),
    isRead: Boolean(conversation.readAt) || conversation.gmailUnread === false,
    action: getActionMetadata(conversation),
  }
}

/** Convert a persisted ConversationState to a CommandCenterConversation for display */
export function persistedStateToCommandCenterConversation(
  persisted: PersistedCommandCenterState,
  conversation: Pick<CommandCenterInputConversation, "id" | "externalThreadId" | "label" | "status" | "readAt" | "gmailUnread" | "lastMessageAt" | "contact" | "channel">,
  lead?: { score: number; scoreExplanation: string | null; estimatedValue?: number | null } | null
): CommandCenterConversation {
  const meta = persisted.metadataJson as Record<string, unknown> | null
  const sensitive =
    meta?.attentionCategory === "review_soon" ||
    meta?.riskLevel === "high" ||
    typeof meta?.escalationReason === "string" ||
    conversation.label === "Complaint"
  const opportunity = meta?.suggestedLabel === "Lead" || conversation.label === "Lead"
  const approvalReasonStr = typeof meta?.escalationReason === "string" && meta.escalationReason.trim()
    ? meta.escalationReason.trim()
    : meta?.riskLevel === "high"
      ? "High-risk conversation"
      : conversation.label === "Complaint"
        ? "Complaint needs careful review"
        : meta?.sensitive === true
          ? "Sensitive topic detected"
          : null

  return {
    id: conversation.id,
    displayName: conversation.contact?.name ?? conversation.externalThreadId,
    state: persisted.state as CommandCenterState,
    priority: persisted.priority as CommandCenterPriority,
    reason: persisted.reason,
    nextAction: persisted.nextAction,
    href: `/conversations/${conversation.id}`,
    lastMessageAt: conversation.lastMessageAt,
    label: conversation.label,
    sensitive,
    approvalReason: approvalReasonStr,
    safelyIgnored:
      persisted.state === "done" ||
      (persisted.state === "fyi_only" && meta?.attentionCategory !== "read_later"),
    needsReply:
      conversation.status === "needs_reply" &&
      persisted.state !== "fyi_only" &&
      (!meta?.attentionCategory || meta.attentionCategory === "needs_reply"),
    needsAction: meta?.attentionCategory === "needs_action",
    readLater: meta?.attentionCategory === "read_later",
    opportunity,
    leadScore: opportunity && lead ? lead.score : null,
    estimatedValue: lead?.estimatedValue ?? null,
    emailType: typeof meta?.emailType === "string" ? meta.emailType : null,
    isRead: Boolean(conversation.readAt) || conversation.gmailUnread === false,
    action: getActionMetadata({ ...conversation, messages: [], conversationState: { metadataJson: meta } }),
  }
}

/** Check if a persisted state is fresh (within TTL) */
const STATE_TTL_MS = 60 * 60 * 1000 // 1 hour

function isPersistedStateFresh(persisted: PersistedCommandCenterState, now: Date): boolean {
  return now.getTime() - new Date(persisted.updatedAt).getTime() < STATE_TTL_MS
}

export function buildDailyCommandCenter(
  conversations: CommandCenterInputConversation[],
  now = new Date(),
  accountType?: unknown,
  persistedStates?: Map<string, PersistedCommandCenterState>
): DailyCommandCenter {
  const accountMode = resolveAccountMode(accountType ?? "business")
  const analyzed = conversations.map((conversation) => {
    if (conversation.status === "closed") {
      return analyzeConversationForCommandCenter(conversation, now, accountMode)
    }
    // Use persisted state if available and fresh
    const persisted = persistedStates?.get(conversation.id)
    if (persisted && isPersistedStateFresh(persisted, now)) {
      return persistedStateToCommandCenterConversation(persisted, conversation, conversation.lead ?? null)
    }
    return analyzeConversationForCommandCenter(conversation, now, accountMode)
  })
  const approvals = analyzed.filter(
    (conversation) => conversation.state === "waiting_on_you" || conversation.approvalReason
  )
  const topActions = analyzed
    .filter((conversation) =>
      conversation.priority !== "none" &&
      !conversation.safelyIgnored &&
      !conversation.readLater &&
      (!conversation.needsAction || conversation.needsReply || conversation.sensitive || conversation.opportunity || Boolean(conversation.approvalReason))
    )
    .sort((a, b) => score(b) - score(a) || b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
    .slice(0, 7)
  const assigned = new Set(topActions.map((conversation) => conversation.id))
  const takeUnassigned = (items: CommandCenterConversation[]) =>
    items.filter((item) => {
      if (assigned.has(item.id)) return false
      assigned.add(item.id)
      return true
    })

  const needsReplyItems = takeUnassigned(analyzed.filter((conversation) => conversation.state === "needs_reply"))
  const needsActionItems = takeUnassigned(analyzed.filter(c => c.needsAction))
  const waitingOnItems = takeUnassigned(analyzed.filter((conversation) => conversation.state === "waiting_on_them"))
  const readLaterItems = takeUnassigned(analyzed.filter(c => c.readLater))
  const safelyIgnoredItems = takeUnassigned(analyzed.filter(c => c.safelyIgnored))
  const breakdown: QuietlyHandledBreakdown = { newsletter: 0, notification: 0, marketing: 0, other: 0 }
  for (const item of safelyIgnoredItems) {
    if (item.emailType === "newsletter") breakdown.newsletter++
    else if (item.emailType === "notification") breakdown.notification++
    else if (item.emailType === "marketing") breakdown.marketing++
    else breakdown.other++
  }

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
      safelyIgnored: safelyIgnoredItems.length,
      needsAction: analyzed.filter(c => c.needsAction).length,
      readLater: analyzed.filter(c => c.readLater).length,
    },
    topActions,
    sections: {
      needsReply: needsReplyItems,
      waitingOnThem: waitingOnItems,
      meetings: analyzed.filter((conversation) => conversation.state === "scheduled"),
      approvals,
      opportunities: analyzed.filter((conversation) => conversation.opportunity),
      potentialProblems: analyzed.filter((conversation) => conversation.sensitive),
      support: analyzed.filter((conversation) => conversation.state === "support"),
      salesQualified: analyzed.filter((conversation) => conversation.state === "sales_qualified"),
      safelyIgnored: safelyIgnoredItems,
      needsAction: needsActionItems,
      readLater: readLaterItems,
    },
    quietlyHandledBreakdown: breakdown,
    conversations: analyzed,
  }
}

export function buildRelationshipContext(
  conversation: CommandCenterInputConversation,
  now = new Date(),
  accountType?: unknown
): RelationshipContext {
  const accountMode = resolveAccountMode(accountType ?? "business")
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
  const state = analyzeConversationForCommandCenter(conversation, now, accountMode)
  const intent = typeof meta.intent === "string" ? meta.intent : null
  const label = typeof meta.suggestedLabel === "string" ? meta.suggestedLabel : conversation.label

  return {
    name: displayName(conversation),
    lastConversationSummary: intent
      ? `Last classified as ${intent}.`
      : latest
        ? stripHtmlToText(latest.body, 200)
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
    (conversation.needsAction ? 8 : 0) +
    (conversation.state === "support" ? 30 : 0) +
    (conversation.state === "sales_qualified" ? 35 : 0) +
    revenueBonus
  )
}

export type BillSignal = {
  conversationId: string
  displayName: string
  href: string
  title: string
  dueAt: Date | null
  type: "task" | "billing_alert"
}

export type BillsSection = {
  items: BillSignal[]
  count: number
}

export function buildBillsSection(
  tasks: Array<{
    id: string
    conversationId: string
    title: string
    dueAt: Date | null
    conversation: { contact: { name: string } | null; externalThreadId: string }
  }>,
  conversations: CommandCenterInputConversation[],
  now = new Date()
): BillsSection {
  const items: BillSignal[] = []
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // Upcoming tasks with due dates
  for (const task of tasks) {
    if (task.dueAt && task.dueAt <= sevenDays) {
      const name = task.conversation.contact?.name ?? task.conversation.externalThreadId
      items.push({
        conversationId: task.conversationId,
        displayName: name,
        href: `/conversations/${task.conversationId}`,
        title: task.title,
        dueAt: task.dueAt,
        type: "task",
      })
    }
  }

  // Conversations with review_soon attention category
  for (const conv of conversations) {
    const meta = conv.conversationState?.metadataJson
    const category =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as Record<string, unknown>).attentionCategory
        : null
    if (category === "review_soon") {
      const name = conv.contact?.name ?? conv.externalThreadId
      items.push({
        conversationId: conv.id,
        displayName: name,
        href: `/conversations/${conv.id}`,
        title: "Billing or security alert",
        dueAt: null,
        type: "billing_alert",
      })
    }
  }

  // Sort by dueAt ascending (nulls last)
  items.sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return 0
    if (!a.dueAt) return 1
    if (!b.dueAt) return -1
    return a.dueAt.getTime() - b.dueAt.getTime()
  })

  return { items: items.slice(0, 8), count: items.length }
}
