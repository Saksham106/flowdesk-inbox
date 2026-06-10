import { describe, expect, it } from 'vitest'

import { evaluateAutonomy } from '@/lib/agent/autonomy'

const baseInput = {
  accountType: 'personal' as const,
  hasLearnedProfile: true,
  autopilotEnabled: true,
  confidence: 0.94,
  confidenceThreshold: 0.85,
  riskLevel: 'low' as const,
  intent: 'routine scheduling',
  escalationReason: null,
  dailyAutoSendCount: 0,
  maxAutoSendsPerDay: 10,
  currentFailures: 0,
  disableAfterFailures: 3,
}

describe('evaluateAutonomy', () => {
  it('allows low-risk confident routine replies when all gates pass', () => {
    expect(evaluateAutonomy(baseInput)).toEqual({ eligible: true, reason: null })
  })

  it('holds personal replies until a learned profile exists', () => {
    expect(evaluateAutonomy({ ...baseInput, hasLearnedProfile: false })).toEqual({
      eligible: false,
      reason: 'learned_profile_required',
    })
  })

  it('holds sensitive messages even when confidence is high', () => {
    expect(evaluateAutonomy({ ...baseInput, intent: 'password reset and account security' })).toEqual({
      eligible: false,
      reason: 'sensitive_intent',
    })
  })

  it('holds messages after the daily auto-send cap is reached', () => {
    expect(evaluateAutonomy({ ...baseInput, dailyAutoSendCount: 10 })).toEqual({
      eligible: false,
      reason: 'daily_cap_reached',
    })
  })
})
