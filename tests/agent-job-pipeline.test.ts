import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockConvFindFirst,
  mockJobCreate,
  mockJobFindUnique,
  mockJobUpdate,
  mockToolCallCreate,
  mockToolCallUpdate,
  mockAuditCreate,
  mockGetFullBusinessContext,
  mockClassify,
  mockCheckAvailability,
  mockTenantFindUnique,
} = vi.hoisted(() => ({
  mockConvFindFirst:          vi.fn(),
  mockJobCreate:              vi.fn(),
  mockJobFindUnique:          vi.fn(),
  mockJobUpdate:              vi.fn(),
  mockToolCallCreate:         vi.fn(),
  mockToolCallUpdate:         vi.fn(),
  mockAuditCreate:            vi.fn(),
  mockGetFullBusinessContext: vi.fn(),
  mockClassify:               vi.fn(),
  mockCheckAvailability:      vi.fn(),
  mockTenantFindUnique:       vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    conversation:  { findFirst: mockConvFindFirst },
    agentJob:      { create: mockJobCreate, findUnique: mockJobFindUnique, update: mockJobUpdate },
    agentToolCall: { create: mockToolCallCreate, update: mockToolCallUpdate },
    auditLog:      { create: mockAuditCreate },
    tenant:        { findUnique: mockTenantFindUnique },
  },
}))

vi.mock('@/lib/agent/context', () => ({
  getFullBusinessContext: mockGetFullBusinessContext,
}))

vi.mock('@/lib/agent/classify', () => ({
  classifyConversation: mockClassify,
}))

vi.mock('@/lib/agent/availability', () => ({
  checkAvailability: mockCheckAvailability,
  formatSlots: (slots: unknown[]) => slots.map(() => 'Monday Jun 10 at 9:00 AM'),
}))

import { createAgentJob, runAgentJob } from '@/lib/agent/jobs'
import { checkPolicy } from '@/lib/agent/policy'
import { normalizeClassifyOutput, buildClassifyPrompt } from '@/lib/ai/prompts/classify'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = 'tenant-1'
const CONV_ID = 'conv-1'
const JOB_ID  = 'job-1'

const baseJob = {
  id: JOB_ID,
  tenantId: TENANT,
  conversationId: CONV_ID,
  trigger: 'manual',
  status: 'pending' as const,
  intent: null,
  confidence: null,
  requiresApproval: true,
  error: null,
  createdAt: new Date(),
  startedAt: null,
  completedAt: null,
}

const goodClassification = {
  intent: 'booking_request',
  confidence: 0.85,
  riskLevel: 'low' as const,
  suggestedLabel: 'Lead' as const,
  escalationReason: null,
  requiresApproval: false,
}

// ---------------------------------------------------------------------------
// normalizeClassifyOutput
// ---------------------------------------------------------------------------

describe('normalizeClassifyOutput', () => {
  it('parses a valid response', () => {
    const result = normalizeClassifyOutput(JSON.stringify(goodClassification))
    expect(result.intent).toBe('booking_request')
    expect(result.confidence).toBe(0.85)
    expect(result.riskLevel).toBe('low')
    expect(result.suggestedLabel).toBe('Lead')
    expect(result.requiresApproval).toBe(false)
    expect(result.attentionCategory).toBe('needs_reply')
    expect(result.classificationReason).toMatch(/booking/i)
  })

  it('parses richer attention category and reason from LLM output', () => {
    const result = normalizeClassifyOutput(JSON.stringify({
      ...goodClassification,
      attentionCategory: 'needs_action',
      classificationReason: 'Contains a password setup link the user must complete.',
    }))

    expect(result.attentionCategory).toBe('needs_action')
    expect(result.classificationReason).toBe('Contains a password setup link the user must complete.')
  })

  it('throws on non-JSON', () => {
    expect(() => normalizeClassifyOutput('not json')).toThrow('valid JSON')
  })

  it('defaults unknown riskLevel to medium', () => {
    const result = normalizeClassifyOutput(
      JSON.stringify({ ...goodClassification, riskLevel: 'extreme' })
    )
    expect(result.riskLevel).toBe('medium')
  })

  it('clamps confidence to [0, 1]', () => {
    expect(normalizeClassifyOutput(JSON.stringify({ ...goodClassification, confidence: 2.5 })).confidence).toBe(1)
    expect(normalizeClassifyOutput(JSON.stringify({ ...goodClassification, confidence: -1 })).confidence).toBe(0)
  })

  it('defaults requiresApproval to true when missing', () => {
    const { requiresApproval: _, ...rest } = goodClassification
    expect(normalizeClassifyOutput(JSON.stringify(rest)).requiresApproval).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// checkPolicy
// ---------------------------------------------------------------------------

describe('checkPolicy', () => {
  it('escalates high-risk conversations', () => {
    const decision = checkPolicy({ ...goodClassification, riskLevel: 'high', escalationReason: 'medical question' })
    expect(decision.requiresApproval).toBe(true)
    expect(decision.escalate).toBe(true)
  })

  it('requires approval when confidence is below threshold', () => {
    const decision = checkPolicy({ ...goodClassification, confidence: 0.3 })
    expect(decision.requiresApproval).toBe(true)
    expect(decision.escalate).toBe(false)
  })

  it('escalates when escalationReason is set even at medium risk', () => {
    const decision = checkPolicy({ ...goodClassification, riskLevel: 'medium', escalationReason: 'complaint' })
    expect(decision.escalate).toBe(true)
  })

  it('respects AI requiresApproval flag at low risk', () => {
    const decision = checkPolicy({ ...goodClassification, requiresApproval: true })
    expect(decision.requiresApproval).toBe(true)
    expect(decision.escalate).toBe(false)
  })

  it('allows proceed when all signals are safe', () => {
    const decision = checkPolicy(goodClassification)
    expect(decision.requiresApproval).toBe(false)
    expect(decision.escalate).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createAgentJob
// ---------------------------------------------------------------------------

describe('createAgentJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a job when conversation belongs to the tenant', async () => {
    mockConvFindFirst.mockResolvedValue({ id: CONV_ID, tenantId: TENANT })
    mockJobCreate.mockResolvedValue(baseJob)

    const job = await createAgentJob({ tenantId: TENANT, conversationId: CONV_ID, trigger: 'manual' })

    expect(job.tenantId).toBe(TENANT)
    expect(mockJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT, conversationId: CONV_ID }) })
    )
  })

  it('throws when conversation does not belong to the tenant', async () => {
    mockConvFindFirst.mockResolvedValue(null)

    await expect(
      createAgentJob({ tenantId: TENANT, conversationId: 'conv-other', trigger: 'manual' })
    ).rejects.toThrow('does not belong to this tenant')

    expect(mockJobCreate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// runAgentJob — happy path
// ---------------------------------------------------------------------------

describe('runAgentJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobFindUnique.mockResolvedValue(baseJob)
    mockJobUpdate.mockResolvedValue({})
    mockConvFindFirst.mockResolvedValue({
      id: CONV_ID,
      tenantId: TENANT,
      messages: [{ direction: 'inbound', body: 'Hello', createdAt: new Date() }],
    })
    mockGetFullBusinessContext.mockResolvedValue({ profile: null, documents: [] })
    mockTenantFindUnique.mockResolvedValue({ accountType: 'business' })
    mockToolCallCreate.mockResolvedValue({ id: 'tc-1' })
    mockToolCallUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
  })

  it('marks job completed and writes an audit log on success', async () => {
    mockClassify.mockResolvedValue(goodClassification)

    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe('completed')
    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'agent_job.completed' }) })
    )
  })

  it('persists intent and confidence from classification', async () => {
    mockClassify.mockResolvedValue(goodClassification)

    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.intent).toBe('booking_request')
      expect(result.confidence).toBe(0.85)
    }
  })

  it('marks requiresApproval true for high-risk classifications', async () => {
    mockClassify.mockResolvedValue({ ...goodClassification, riskLevel: 'high', escalationReason: 'emergency' })

    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      expect(result.requiresApproval).toBe(true)
    }
  })

  it('marks job failed and writes audit log when classify throws', async () => {
    mockClassify.mockRejectedValue(new Error('OpenAI error'))

    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.error).toBe('OpenAI error')
    }
    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'agent_job.failed' }) })
    )
  })

  it('returns failed (not throws) when job is not found', async () => {
    mockJobFindUnique.mockResolvedValue(null)

    const result = await runAgentJob('nonexistent')

    expect(result.status).toBe('failed')
  })

  it('logs an AgentToolCall for the classify step', async () => {
    mockClassify.mockResolvedValue(goodClassification)

    await runAgentJob(JOB_ID)

    expect(mockToolCallCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toolName: 'classifyConversation', agentJobId: JOB_ID }),
      })
    )
    expect(mockToolCallUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) })
    )
  })

  it('calls checkAvailability when scheduling intent is detected and primaryCalendarEmail is set', async () => {
    mockClassify.mockResolvedValue({ ...goodClassification, intent: 'book appointment', suggestedLabel: 'Reschedule' })
    mockGetFullBusinessContext.mockResolvedValue({
      profile: {
        primaryCalendarEmail: 'biz@example.com',
        serviceDurationMinutes: 60,
        timezone: 'America/New_York',
        businessHoursJson: null,
      },
      documents: [],
    })
    mockCheckAvailability.mockResolvedValue([
      { start: new Date(), end: new Date(Date.now() + 3600000) },
    ])

    await runAgentJob(JOB_ID)

    expect(mockCheckAvailability).toHaveBeenCalledWith(
      TENANT,
      'biz@example.com',
      expect.objectContaining({ durationMinutes: 60 })
    )
    expect(mockToolCallCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toolName: 'checkAvailability' }),
      })
    )
  })

  it('skips checkAvailability when no primaryCalendarEmail is set', async () => {
    mockClassify.mockResolvedValue({ ...goodClassification, intent: 'book appointment' })
    mockGetFullBusinessContext.mockResolvedValue({
      profile: { primaryCalendarEmail: null, serviceDurationMinutes: 60 },
      documents: [],
    })

    await runAgentJob(JOB_ID)

    expect(mockCheckAvailability).not.toHaveBeenCalled()
  })

  it('skips checkAvailability for non-scheduling intent', async () => {
    mockClassify.mockResolvedValue({ ...goodClassification, intent: 'pricing question', suggestedLabel: 'Pricing' })
    mockGetFullBusinessContext.mockResolvedValue({
      profile: { primaryCalendarEmail: 'biz@example.com', serviceDurationMinutes: 60 },
      documents: [],
    })

    await runAgentJob(JOB_ID)

    expect(mockCheckAvailability).not.toHaveBeenCalled()
  })
})

describe("personal vs business classify prompt", () => {
  it("personal account prompt does not mention sales or leads", () => {
    // buildClassifyPrompt imported at top of file
    const prompt = buildClassifyPrompt({
      accountType: "personal",
      businessProfile: null,
      messages: [{ direction: "inbound", body: "Hey can we meet?", createdAt: new Date() }],
    })
    expect(prompt).not.toMatch(/lead/i)
    expect(prompt).not.toMatch(/sales potential/i)
    expect(prompt).not.toMatch(/business owner/i)
    expect(prompt).not.toMatch(/CRM/i)
    expect(prompt).toMatch(/personal inbox/i)
    expect(prompt).toMatch(/suggestedLabel to null/i)
    expect(prompt).toMatch(/attentionCategory/i)
    expect(prompt).toMatch(/needs_action/i)
  })

  it("business account prompt includes business framing and CRM labels", () => {
    // buildClassifyPrompt imported at top of file
    const prompt = buildClassifyPrompt({
      accountType: "business",
      businessProfile: null,
      messages: [{ direction: "inbound", body: "I want pricing info", createdAt: new Date() }],
    })
    expect(prompt).toMatch(/small business inbox/i)
    expect(prompt).toMatch(/Lead/i)
    expect(prompt).toMatch(/Complaint/i)
  })

  it("null accountType defaults to business prompt", () => {
    // buildClassifyPrompt imported at top of file
    const prompt = buildClassifyPrompt({
      accountType: null,
      businessProfile: null,
      messages: [{ direction: "inbound", body: "Hello", createdAt: new Date() }],
    })
    expect(prompt).toMatch(/small business inbox/i)
  })
})
