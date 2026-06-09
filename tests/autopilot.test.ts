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
  mockGetFullBusinessContext,
  mockGenerateDraftReply,
  mockSendConversationMessage,
} = vi.hoisted(() => ({
  mockAutopilotSettingFindUnique: vi.fn(),
  mockAutopilotSettingUpdate:     vi.fn(),
  mockAutopilotSettingUpdateMany: vi.fn(),
  mockJobFindUnique:              vi.fn(),
  mockDraftUpsert:                vi.fn(),
  mockDraftUpdate:                vi.fn(),
  mockAuditCreate:                vi.fn(),
  mockGetFullBusinessContext:     vi.fn(),
  mockGenerateDraftReply:         vi.fn(),
  mockSendConversationMessage:    vi.fn(),
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
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock('@/lib/agent/context', () => ({
  getFullBusinessContext: mockGetFullBusinessContext,
}))

vi.mock('@/lib/ai/provider', () => ({
  generateDraftReply: mockGenerateDraftReply,
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

  it('returns eligible when allowedIntentsJson matches the intent', async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({
      ...enabledSetting,
      allowedIntentsJson: ['booking', 'appointment'],
    })
    const result = await checkAutopilotEligibility(TENANT, classification, policyOk)
    expect(result.eligible).toBe(true)
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
    mockGetFullBusinessContext.mockResolvedValue({
      profile: { id: 'bp-1', timezone: 'America/New_York' },
      documents: [],
    })
    mockGenerateDraftReply.mockResolvedValue({ draftText: 'Hello, here is your reply.', intent: 'booking', confidence: 0.92 })
    mockDraftUpsert.mockResolvedValue({ id: 'draft-1' })
    mockDraftUpdate.mockResolvedValue({})
    mockSendConversationMessage.mockResolvedValue({ ok: true, providerMessageId: 'gmail_msg-1' })
    mockAuditCreate.mockResolvedValue({})
    mockAutopilotSettingUpdateMany.mockResolvedValue({})
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
    mockGetFullBusinessContext.mockResolvedValue({ profile: null, documents: [] })
    const result = await attemptAutopilotSend(JOB_ID, classification, policyOk)
    expect(result.sent).toBe(false)
  })
})
