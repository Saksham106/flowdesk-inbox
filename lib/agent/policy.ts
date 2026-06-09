import type { ClassifyResult } from "@/lib/ai/prompts/classify"

export type PolicyDecision = {
  requiresApproval: boolean
  escalate: boolean
  reason: string | null
}

const CONFIDENCE_THRESHOLD = 0.4

export function checkPolicy(classification: ClassifyResult): PolicyDecision {
  if (classification.riskLevel === "high") {
    return {
      requiresApproval: true,
      escalate: true,
      reason: classification.escalationReason ?? "High-risk conversation",
    }
  }

  if (classification.confidence < CONFIDENCE_THRESHOLD) {
    return {
      requiresApproval: true,
      escalate: false,
      reason: `Low confidence (${(classification.confidence * 100).toFixed(0)}%)`,
    }
  }

  if (classification.escalationReason) {
    return {
      requiresApproval: true,
      escalate: true,
      reason: classification.escalationReason,
    }
  }

  if (classification.requiresApproval) {
    return {
      requiresApproval: true,
      escalate: false,
      reason: null,
    }
  }

  return { requiresApproval: false, escalate: false, reason: null }
}
