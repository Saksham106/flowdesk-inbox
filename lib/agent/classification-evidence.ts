type EvidenceMessage = {
  direction: string
  fromE164?: string | null
  body: string
  subject?: string | null
  createdAt: Date | string
}

type EvidenceState = {
  source?: string | null
  attentionCategory?: string | null
  emailType?: string | null
  metadataJson?: unknown
}

export type ClassificationEvidence = {
  sender: { email: string | null; domain: string | null }
  latestInbound: { body: string; subject: string | null; createdAt: string } | null
  recentReciprocalReplies: Array<{ direction: "inbound" | "outbound"; body: string }>
  unsubscribe: boolean
  calendarInvite: boolean
  notificationHeaders: string[]
  deterministicSignals: string[]
  priorCorrection: { attentionCategory: string | null; emailType: string | null } | null
  priorRuleEvidence: string[]
  hasGmailOverride: boolean
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function extractEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.match(/<([^>\s]+@[^>\s]+)>|([\w.+-]+@[\w.-]+)/)
  return (match?.[1] ?? match?.[2] ?? null)?.toLowerCase() ?? null
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

export function buildClassificationEvidence(input: {
  messages: EvidenceMessage[]
  stateRecord?: EvidenceState | null
}): ClassificationEvidence {
  const ordered = [...input.messages].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  const inbound = ordered.filter((message) => message.direction === "inbound")
  const latestInboundMessage = [...inbound].reverse().find((message) => message.body.trim()) ?? null
  const senderEmail = extractEmail(latestInboundMessage?.fromE164)
  const body = inbound.map((message) => message.body).join("\n")
  const notificationHeaders = [...body.matchAll(/^\s*(x-(?:github|gitlab|slack|ms|notification)[\w-]*|precedence|auto-submitted)\s*:/gim)]
    .map((match) => match[1].toLowerCase())
  const unsubscribe = /(?:^|\n)\s*list-unsubscribe\s*:|\bunsubscribe\b/i.test(body)
  const calendarInvite = /begin:vcalendar|content-type:\s*text\/calendar|\bmethod:(?:request|reply|cancel)\b|\.ics\b/i.test(body)
  const signals = [
    ...(unsubscribe ? ["list_unsubscribe"] : []),
    ...(calendarInvite ? ["calendar_invite"] : []),
    ...notificationHeaders.map((header) => `notification_header:${header}`),
  ]
  const metadata = metadataRecord(input.stateRecord?.metadataJson)
  const corrected = metadata.attentionCorrectedByUser === true || metadata.userOverride === true
  const hasGmailOverride = (() => {
    const value = metadataRecord(metadata.gmailLabelOverride)
    return typeof value.workflow === "string" || typeof value.contentType === "string" || typeof value.updatedAt === "string"
  })()
  const priorRuleEvidence = ["learnedRuleId", "ruleId", "ruleSource", "attentionReason"]
    .map((key) => metadata[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)

  return {
    sender: {
      email: senderEmail,
      domain: senderEmail?.split("@")[1] ?? null,
    },
    latestInbound: latestInboundMessage
      ? { body: latestInboundMessage.body.trim(), subject: latestInboundMessage.subject ?? null, createdAt: timestamp(latestInboundMessage.createdAt) }
      : null,
    recentReciprocalReplies: ordered
      .filter((message) => (message.direction === "inbound" || message.direction === "outbound") && message.body.trim())
      .slice(-6)
      .map((message) => ({ direction: message.direction as "inbound" | "outbound", body: message.body.trim().slice(0, 800) })),
    unsubscribe,
    calendarInvite,
    notificationHeaders,
    deterministicSignals: signals,
    priorCorrection: corrected || hasGmailOverride
      ? { attentionCategory: input.stateRecord?.attentionCategory ?? null, emailType: input.stateRecord?.emailType ?? null }
      : null,
    priorRuleEvidence,
    hasGmailOverride,
  }
}
