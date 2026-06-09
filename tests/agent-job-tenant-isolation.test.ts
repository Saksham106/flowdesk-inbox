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
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    conversation:  { findFirst: mockConvFindFirst },
    agentJob:      { create: mockJobCreate, findUnique: mockJobFindUnique, update: mockJobUpdate },
    agentToolCall: { create: mockToolCallCreate, update: mockToolCallUpdate },
    auditLog:      { create: mockAuditCreate },
  },
}))

vi.mock('@/lib/agent/context', () => ({
  getFullBusinessContext: mockGetFullBusinessContext,
}))

vi.mock('@/lib/agent/classify', () => ({
  classifyConversation: mockClassify,
}))

import { createAgentJob, runAgentJob } from '@/lib/agent/jobs'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAgentJob — tenant isolation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('scopes the conversation lookup to the caller tenantId', async () => {
    mockConvFindFirst.mockResolvedValue(null)

    await expect(
      createAgentJob({ tenantId: 'tenant-A', conversationId: 'conv-1', trigger: 'manual' })
    ).rejects.toThrow()

    const whereArg = mockConvFindFirst.mock.calls[0][0].where
    expect(whereArg.tenantId).toBe('tenant-A')
  })

  it('does not create a job for a conversation owned by another tenant', async () => {
    mockConvFindFirst.mockResolvedValue(null) // tenant-B's conv returns null for tenant-A

    await expect(
      createAgentJob({ tenantId: 'tenant-A', conversationId: 'conv-tenant-B', trigger: 'sync' })
    ).rejects.toThrow('does not belong to this tenant')

    expect(mockJobCreate).not.toHaveBeenCalled()
  })

  it('creates the job with tenantId from the input, not from the conversation record', async () => {
    mockConvFindFirst.mockResolvedValue({ id: 'conv-1', tenantId: 'tenant-A' })
    mockJobCreate.mockResolvedValue({ id: 'job-1', tenantId: 'tenant-A' })

    await createAgentJob({ tenantId: 'tenant-A', conversationId: 'conv-1', trigger: 'manual' })

    const createData = mockJobCreate.mock.calls[0][0].data
    expect(createData.tenantId).toBe('tenant-A')
  })
})

describe('runAgentJob — tenant isolation', () => {
  const job = {
    id: 'job-1',
    tenantId: 'tenant-A',
    conversationId: 'conv-1',
    trigger: 'manual',
    status: 'pending',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockJobFindUnique.mockResolvedValue(job)
    mockJobUpdate.mockResolvedValue({})
    mockToolCallCreate.mockResolvedValue({ id: 'tc-1' })
    mockToolCallUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockGetFullBusinessContext.mockResolvedValue({ profile: null, documents: [] })
  })

  it('scopes conversation lookup to job.tenantId during execution', async () => {
    mockConvFindFirst.mockResolvedValue(null) // simulate cross-tenant miss

    const result = await runAgentJob('job-1')

    // Should fail gracefully — not expose data from another tenant
    expect(result.status).toBe('failed')

    const convWhere = mockConvFindFirst.mock.calls[0][0].where
    expect(convWhere.tenantId).toBe('tenant-A')
    expect(convWhere.id).toBe('conv-1')
  })

  it('audit logs carry tenantId from the job, not from any input param', async () => {
    mockConvFindFirst.mockResolvedValue({
      id: 'conv-1',
      tenantId: 'tenant-A',
      messages: [],
    })
    mockClassify.mockResolvedValue({
      intent: 'inquiry',
      confidence: 0.9,
      riskLevel: 'low',
      suggestedLabel: null,
      escalationReason: null,
      requiresApproval: false,
    })

    await runAgentJob('job-1')

    const auditData = mockAuditCreate.mock.calls[0][0].data
    expect(auditData.tenantId).toBe('tenant-A')
  })
})
