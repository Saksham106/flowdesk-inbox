import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockAutopilotSettingFindUnique,
  mockAutopilotSettingUpdate,
  mockAutopilotSettingUpdateMany,
  mockJobFindUnique,
  mockDraftUpsert,
  mockDraftUpdate,
  mockAuditCreate,
  mockAuditCount,
  mockApprovalUpdateMany,
  mockAiUsageCreate,
  mockGetFullBusinessContext,
  mockGetReplyGenerationContext,
  mockGenerateDraftReply,
  mockCheckAiBudgetForTokens,
  mockSendConversationMessage,
  mockUserFindFirst,
} = vi.hoisted(() => ({
  mockAutopilotSettingFindUnique: vi.fn(),
  mockAutopilotSettingUpdate:     vi.fn(),
  mockAutopilotSettingUpdateMany: vi.fn(),
  mockJobFindUnique:              vi.fn(),
  mockDraftUpsert:                vi.fn(),
  mockDraftUpdate:                vi.fn(),
  mockAuditCreate:                vi.fn(),
  mockAuditCount:                 vi.fn(),
  mockApprovalUpdateMany:         vi.fn(),
  mockAiUsageCreate:              vi.fn(),
  mockGetFullBusinessContext:     vi.fn(),
  mockGetReplyGenerationContext:  vi.fn(),
  mockGenerateDraftReply:         vi.fn(),
  mockCheckAiBudgetForTokens:     vi.fn(),
  mockSendConversationMessage:    vi.fn(),
  mockUserFindFirst:              vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    autopilotSetting: {
      findUnique:  mockAutopilotSettingFindUnique,
      update:      mockAutopilotSettingUpdate,
      updateMany:  mockAutopilotSettingUpdateMany,
    },
    agentJob: { findUnique: mockJobFindUnique },
    draft:    { upsert: mockDraftUpsert, update: mockDraftUpdate },
    auditLog: { create: mockAuditCreate, count: mockAuditCount },
    approvalRequest: { updateMany: mockApprovalUpdateMany },
    aiUsageEvent: { create: mockAiUsageCreate },
    user: { findFirst: mockUserFindFirst },
  },
}))

vi.mock('@/lib/agent/context', () => ({
  getFullBusinessContext: mockGetFullBusinessContext,
}))

vi.mock('@/lib/agent/reply-context', () => ({
  getReplyGenerationContext: mockGetReplyGenerationContext,
}))

vi.mock('@/lib/ai/provider', () => ({
  generateDraftReply: mockGenerateDraftReply,
}))

vi.mock('@/lib/ai/budget', () => ({
  checkAiBudgetForTokens: mockCheckAiBudgetForTokens,
  estimateCostUsd: () => 0.01,
}))

vi.mock('@/lib/conversations/send-message', () => ({
  sendConversationMessage: mockSendConversationMessage,
  ConversationSendError: class ConversationSendError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
}))

import {
  checkAutopilotEligibility,
  recordAutopilotFailure,
  recordAutopilotSuccess,
  attemptAutopilotSend,
} from '@/lib/agent/autopilot'
import type { ClassifyResult } from '@/lib/ai/prompts/classify'
import type { PolicyDecision } from '@/lib/agent/policy'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = 'tenant-1'
const JOB_ID = 'job-1'
const CONV_ID = 'conv-1'

const classification: ClassifyResult = {
  intent: 'appointment booking request',
  attentionCategory: 'needs_reply',
  classificationReason: 'Customer is asking to book an appointment.',
  confidence: 0.92,
  riskLevel: 'low',
  requiresApproval: false,
  suggestedLabel: 'Lead',
  escalationReason: null,
}

const policyOk: PolicyDecision = { requiresApproval: false, escalate: false, reason: null }
const policyRequires: PolicyDecision = { requiresApproval: true, escalate: false, reason: 'low confidence' }

const enabledSetting = {
  tenantId: TENANT,
  enabled: true,
  automationLevel: 5,
  confidenceThreshold: 0.85,
  allowedIntentsJson: null,
  disableAfterFailures: 3,
  currentFailures: 0,
  disabledAt: null,
}

const baseJob = {
  id: JOB_ID,
  tenantId: TENANT,
  conversationId: CONV_ID,
  slotsJson: null,
  conversation: {
    channelId: 'channel-1',
    channel: { type: 'email' },
    messages: [],
  },
}

// ---------------------------------------------------------------------------
// checkAutopilotEligibility
// ---------------------------------------------------------------------------

describe('checkAutopilotEligibility', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ineligible when policy requires approval', async () => {
    const result = await checkAutopilotEligibility(TENANT, classification, policyRequires)
    expect(result.eligible).toBe(false)
    expect(mockAutopilotSettingFindUnique).not.toHaveBeenCalled()
  })

  it('returns ineligible when autopilot setting does not exist', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue(null)
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(false)
  })

  it('returns ineligible when autopilot is disabled', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({ ...enabledSetting, enabled: false })
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(false)
  })

  it('returns ineligible when autopilot has been auto-disabled after failures', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      disabledAt: new Date(),
    })
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reason).toContain('failures')
    }
  })

  it('returns ineligible when confidence is below threshold', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      confidenceThreshold: 0.95,
    })
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reason.toLowerCase()).toContain('confidence')
    }
  })

  it('returns ineligible when intent is not in allowed list', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      allowedIntentsJson: ['FAQ'],
    })
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(false)
  })

  it('returns eligible when all conditions are met', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue(enabledSetting)
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(true)
  })

  it('returns ineligible below automation Level 5 even with autopilot enabled', async () => {
    for (const automationLevel of [0, 1, 2, 3, 4]) {
      mockAutopilotSettingFindUnique.mockResolvedValue({ ...enabledSetting, automationLevel })
      const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
      expect(result.eligible).toBe(false)
      if (!result.eligible) {
        expect(result.reason).toContain('Automation level')
      }
    }
  })

  it('fails closed when automationLevel is missing from the setting row', async () => {
    const { automationLevel: _omitted, ...withoutLevel } = enabledSetting
    mockAutopilotSettingFindUnique.mockResolvedValue(withoutLevel)
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(false)
  })

  it('returns eligible when allowedIntentsJson matches the intent', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      allowedIntentsJson: ['booking', 'appointment'],
    })
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(true)
  })

  it('returns ineligible when confidence is below the per-category threshold for the intent', async () => {
    // classification.intent = 'appointment booking request', confidence = 0.92
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      categoryThresholdsJson: { 'appointment booking request': 0.95 },
    })
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reason).toContain('per-category threshold')
      expect(result.reason).toContain('appointment booking request')
    }
  })

  it('per-category threshold lookup is case-insensitive', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      categoryThresholdsJson: { 'Appointment Booking Request': 0.95 },
    })
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(false)
  })

  it('ignores per-category threshold when the intent key is absent', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      categoryThresholdsJson: { 'complaint': 0.99 },
    })
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(true)
  })

  it('returns ineligible when the per-category policy requires approval', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      categoryThresholdsJson: {
        'appointment booking request': { action: 'require_approval' },
      },
    })

    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)

    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reason).toContain('requires approval')
    }
  })

  it('returns ineligible when the per-category policy is never auto-send', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      categoryThresholdsJson: {
        'appointment booking request': { action: 'never' },
      },
    })

    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)

    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reason).toContain('disallows auto-send')
    }
  })

  it('enforces object-form per-category auto-send thresholds', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      categoryThresholdsJson: {
        'appointment booking request': { action: 'auto_send', threshold: 0.95 },
      },
    })

    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)

    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reason).toContain('per-category threshold')
    }
  })
})

// ---------------------------------------------------------------------------
// recordAutopilotFailure / recordAutopilotSuccess
// ---------------------------------------------------------------------------

describe('recordAutopilotFailure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('increments the failure count', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({ ...enabledSetting, currentFailures: 1 })
    mockAutopilotSettingUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})

    await recordAutopilotFailure(TENANT)

    expect(mockAutopilotSettingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentFailures: 2 }),
      })
    )
  })

  it('disables autopilot when failure count reaches the threshold', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      currentFailures: 2,
      disableAfterFailures: 3,
    })
    mockAutopilotSettingUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})

    await recordAutopilotFailure(TENANT)

    const updateCall = mockAutopilotSettingUpdate.mock.calls[0][0]
    expect(updateCall.data.disabledAt).toBeInstanceOf(Date)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'autopilot.disabled_after_failures' }),
      })
    )
  })

  it('does nothing when setting does not exist', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue(null)
    await recordAutopilotFailure(TENANT)
    expect(mockAutopilotSettingUpdate).not.toHaveBeenCalled()
  })
})

describe('recordAutopilotSuccess', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resets the failure count', async () => {
    mockAutopilotSettingUpdateMany.mockResolvedValue({ count: 1 })
    await recordAutopilotSuccess(TENANT)
    expect(mockAutopilotSettingUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT, currentFailures: { gt: 0 } },
        data: { currentFailures: 0 },
      })
    )
  })
})

// ---------------------------------------------------------------------------
// attemptAutopilotSend
// ---------------------------------------------------------------------------

describe('attemptAutopilotSend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobFindUnique.mockResolvedValue(baseJob)
    mockAutopilotSettingFindUnique.mockResolvedValue(enabledSetting)
    mockGetReplyGenerationContext.mockResolvedValue({
      accountType: 'business',
      businessProfile: { id: 'bp-1', timezone: 'America/New_York' },
      knowledgeDocuments: [],
      learnedProfile: { id: 'learned-1', promptVersion: 'reply-learning-v1' },
    })
    mockAuditCount.mockResolvedValue(0)
    mockGenerateDraftReply.mockResolvedValue({ draftText: 'Hello, here is your reply.', intent: 'booking', confidence: 0.92 })
    mockDraftUpsert.mockResolvedValue({ id: 'draft-1' })
    mockDraftUpdate.mockResolvedValue({})
    mockSendConversationMessage.mockResolvedValue({ ok: true, providerMessageId: 'gmail_msg-1' })
    mockAuditCreate.mockResolvedValue({})
    mockAutopilotSettingUpdateMany.mockResolvedValue({})
    mockAiUsageCreate.mockResolvedValue({})
    mockCheckAiBudgetForTokens.mockResolvedValue({ allowed: true, reason: 'Within budget' })
    mockApprovalUpdateMany.mockResolvedValue({ count: 0 })
    mockUserFindFirst.mockResolvedValue({ id: 'owner-1', email: 'owner@example.com' })
  })

  it('returns sent: false when the tenant has no user to attribute the AI call to', async () => {
    mockUserFindFirst.mockResolvedValue(null)
    const result = await attemptAutopilotSend(JOB_ID, classification, policyOk)
    expect(result.sent).toBe(false)
    expect(mockGenerateDraftReply).not.toHaveBeenCalled()
  })

  it('sends draft and returns sent: true on success', async () => {
    const result = await attemptAutopilotSend(JOB_ID, classification, policyOk)

    expect(result.sent).toBe(true)
    expect(mockSendConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        conversationId: CONV_ID,
        auditAction: 'autopilot.send',
      })
    )
  })

  it('returns sent: false when policy requires approval', async () => {
    const result = await attemptAutopilotSend(JOB_ID, classification, policyRequires)
    expect(result.sent).toBe(false)
    expect(mockSendConversationMessage).not.toHaveBeenCalled()
  })

  it('returns sent: false when job is not found', async () => {
    mockJobFindUnique.mockResolvedValue(null)
    const result = await attemptAutopilotSend(JOB_ID, classification, policyOk)
    expect(result.sent).toBe(false)
  })

  it('returns sent: false and records failure when send throws', async () => {
    mockSendConversationMessage.mockRejectedValue(new Error('Gmail error'))
    mockAutopilotSettingFindUnique
      .mockResolvedValueOnce(enabledSetting)   // eligibility check
      .mockResolvedValueOnce(enabledSetting)   // recordAutopilotFailure

    const result = await attemptAutopilotSend(JOB_ID, classification, policyOk)

    expect(result.sent).toBe(false)
    expect(mockAutopilotSettingUpdate).toHaveBeenCalled()
  })

  it('returns sent: false when channel is not email', async () => {
    mockJobFindUnique.mockResolvedValue({
      ...baseJob,
      conversation: { ...baseJob.conversation, channel: { type: 'sms' } },
    })
    const result = await attemptAutopilotSend(JOB_ID, classification, policyOk)
    expect(result.sent).toBe(false)
    if (!result.sent) expect(result.reason).toContain('email')
  })

  it('returns sent: false when business profile is not configured', async () => {
    mockGetReplyGenerationContext.mockResolvedValue({
      accountType: 'business',
      businessProfile: null,
      knowledgeDocuments: [],
      learnedProfile: { id: 'learned-1' },
    })
    const result = await attemptAutopilotSend(JOB_ID, classification, policyOk)
    expect(result.sent).toBe(false)
  })

  it('returns sent: false when AI budget would be exceeded', async () => {
    // Budget gating now happens inside the gateway (runAiJsonFeature), which
    // throws when the tenant is over budget. generateDraftReply surfaces
    // that as a rejected promise; autopilot.ts no longer does its own
    // pre-check or AiUsageEvent recording (that's the gateway's job, and
    // doing it here too would double-count spend).
    mockGenerateDraftReply.mockRejectedValue(new Error('Daily AI spend limit reached'))

    const result = await attemptAutopilotSend(JOB_ID, classification, policyOk)

    expect(result.sent).toBe(false)
    if (!result.sent) expect(result.reason).toBe('Draft generation failed')
    expect(mockAutopilotSettingUpdate).toHaveBeenCalled()
  })

  it('returns sent: false and logs a hold when learned profile is missing', async () => {
    mockGetReplyGenerationContext.mockResolvedValue({
      accountType: 'personal',
      businessProfile: null,
      knowledgeDocuments: [],
      learnedProfile: null,
    })

    const result = await attemptAutopilotSend(JOB_ID, classification, policyOk)

    expect(result.sent).toBe(false)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'autopilot.held',
          payloadJson: expect.objectContaining({ reason: 'learned_profile_required' }),
        }),
      })
    )
  })
})
