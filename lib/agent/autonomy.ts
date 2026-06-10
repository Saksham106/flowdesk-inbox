import type { RiskLevel } from "@/lib/ai/prompts/draft-reply"

export type AutonomyReason =
  | "autopilot_disabled"
  | "learned_profile_required"
  | "high_or_medium_risk"
  | "low_confidence"
  | "sensitive_intent"
  | "escalation_required"
  | "daily_cap_reached"
  | "failure_limit_reached"

export type AutonomyDecision =
  | { eligible: true; reason: null }
  | { eligible: false; reason: AutonomyReason }

const SENSITIVE_PATTERN =
  /legal|lawyer|medical|doctor|diagnos|financial|bank|payment|refund|password|security|employment|hiring|fired|complaint|angry|urgent|emergency|relationship|divorce|conflict/i

export function evaluateAutonomy(input: {
  accountType: "personal" | "business"
  hasLearnedProfile: boolean
  autopilotEnabled: boolean
  confidence: number
  confidenceThreshold: number
  riskLevel: RiskLevel
  intent: string
  escalationReason: string | null
  dailyAutoSendCount: number
  maxAutoSendsPerDay: number
  currentFailures: number
  disableAfterFailures: number
}): AutonomyDecision {
  if (!input.autopilotEnabled) {
    return { eligible: false, reason: "autopilot_disabled" }
  }

  if (!input.hasLearnedProfile) {
    return { eligible: false, reason: "learned_profile_required" }
  }

  if (input.riskLevel !== "low") {
    return { eligible: false, reason: "high_or_medium_risk" }
  }

  if (input.escalationReason) {
    return { eligible: false, reason: "escalation_required" }
  }

  if (input.confidence < input.confidenceThreshold) {
    return { eligible: false, reason: "low_confidence" }
  }

  if (SENSITIVE_PATTERN.test(input.intent)) {
    return { eligible: false, reason: "sensitive_intent" }
  }

  if (input.dailyAutoSendCount >= input.maxAutoSendsPerDay) {
    return { eligible: false, reason: "daily_cap_reached" }
  }

  if (input.currentFailures >= input.disableAfterFailures) {
    return { eligible: false, reason: "failure_limit_reached" }
  }

  return { eligible: true, reason: null }
}
