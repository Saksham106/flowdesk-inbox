import type { EmailClassifierResult } from "@/lib/agent/email-classifier"

export type AiProcessingTier = 0 | 1 | 2 | 3

type PolicyConversation = {
  id: string
  label?: string | null
  status?: string | null
  contactId?: string | null
  messages: Array<{
    direction: string
    body: string
  }>
}

export type PersonMemoryPolicyDecision = {
  tier: AiProcessingTier
  shouldRunLLM: boolean
  reason: string
}

const TRANSACTIONAL_ACTION_TYPES = new Set([
  "otp_code",
  "verify_email",
  "confirm_account",
  "create_password",
  "reset_password",
  "login_approval",
  "account_setup",
  "security_alert",
])

const LOW_VALUE_ATTENTION = new Set(["quiet", "fyi_done", "read_later"])
const AUTOMATED_EMAIL_TYPES = new Set(["notification", "newsletter", "marketing", "fyi"])

export function evaluatePersonMemoryPolicy(input: {
  conversation: PolicyConversation
  accountType?: "personal" | "business" | string | null
  emailClassification?: EmailClassifierResult | null
  isSalesLead: boolean
  isSupport: boolean
}): PersonMemoryPolicyDecision {
  const { conversation, emailClassification } = input

  if (!conversation.contactId) {
    return { tier: 0, shouldRunLLM: false, reason: "No saved contact for relationship memory." }
  }

  const actionType = emailClassification?.action?.type
  if (actionType && TRANSACTIONAL_ACTION_TYPES.has(actionType)) {
    return {
      tier: 1,
      shouldRunLLM: false,
      reason: "Transactional account email; deterministic action metadata is enough.",
    }
  }

  const attentionCategory = emailClassification?.attentionCategory
  if (attentionCategory && LOW_VALUE_ATTENTION.has(attentionCategory)) {
    return {
      tier: 0,
      shouldRunLLM: false,
      reason: "Quiet or low-value automated email; relationship memory would not help.",
    }
  }

  if (
    emailClassification?.emailType &&
    AUTOMATED_EMAIL_TYPES.has(emailClassification.emailType) &&
    attentionCategory !== "needs_reply"
  ) {
    return {
      tier: 1,
      shouldRunLLM: false,
      reason: "Automated notification; deterministic classification is enough.",
    }
  }

  if (input.isSalesLead || input.isSupport || conversation.label === "Lead" || conversation.label === "Complaint") {
    return {
      tier: 3,
      shouldRunLLM: true,
      reason: "High-value business conversation; relationship memory can improve follow-up.",
    }
  }

  const hasOutbound = conversation.messages.some((message) => message.direction === "outbound")
  const latestInbound = [...conversation.messages].reverse().find((message) => message.direction === "inbound")

  if (attentionCategory === "needs_reply" || hasOutbound || latestInbound) {
    return {
      tier: 2,
      shouldRunLLM: true,
      reason: "Human conversation where relationship context may help.",
    }
  }

  return {
    tier: 1,
    shouldRunLLM: false,
    reason: "No clear relationship value from richer AI processing.",
  }
}
