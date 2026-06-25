type FyiConversationInput = {
  status: string
  stateRecord: {
    state?: string | null
    metadataJson?: unknown
    attentionCategory?: string | null
    emailType?: string | null
  } | null
  contact: { phoneE164?: string | null } | null
  messages: { direction: string; body: string }[]
}

export const AUTOMATED_SENDER_RE = /\b(no-?reply|noreply|notifications?|alerts?|do-not-reply|automated)\b/i
export const AUTOMATED_BODY_RE =
  /\b(unsubscribe|you'?re receiving this|this is an automated (email|message|notification)|do not reply to this email)\b/i
export const FYI_RE = /\b(fyi|newsletter|for your records|no action|all set|thanks, all set)\b/i
const FYI_ATTENTION = new Set(["quiet", "fyi_done"])
export const FYI_EMAIL_TYPES = new Set(["notification", "newsletter", "marketing"])

export function isFyiConversation(conversation: FyiConversationInput): boolean {
  if (
    conversation.stateRecord?.attentionCategory &&
    FYI_ATTENTION.has(conversation.stateRecord.attentionCategory)
  ) {
    return true
  }
  if (conversation.stateRecord?.attentionCategory) return false
  if (
    conversation.stateRecord?.emailType &&
    FYI_EMAIL_TYPES.has(conversation.stateRecord.emailType)
  ) {
    return true
  }

  const meta = conversation.stateRecord?.metadataJson
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const attentionCategory = (meta as Record<string, unknown>).attentionCategory
    if (typeof attentionCategory === "string") {
      return FYI_ATTENTION.has(attentionCategory)
    }

    const emailType = (meta as Record<string, unknown>).emailType
    if (typeof emailType === "string" && FYI_EMAIL_TYPES.has(emailType)) {
      return true
    }
  }

  if (conversation.stateRecord?.state === "fyi_only") return true
  if (conversation.status !== "needs_reply") return false

  const msg = conversation.messages[0]
  if (!msg || msg.direction !== "inbound") return false

  const senderEmail = conversation.contact?.phoneE164 ?? ""
  return AUTOMATED_SENDER_RE.test(senderEmail) || AUTOMATED_BODY_RE.test(msg.body) || FYI_RE.test(msg.body)
}
