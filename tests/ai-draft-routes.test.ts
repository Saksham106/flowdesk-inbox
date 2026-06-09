import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockConversationFindFirst,
  mockConversationUpdate,
  mockDraftUpsert,
  mockDraftUpdate,
  mockDraftFindUnique,
  mockAuditCreate,
  mockGenerateDraftReply,
  mockGetFullBusinessContext,
  mockSendConversationMessage,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockConversationUpdate: vi.fn(),
  mockDraftUpsert: vi.fn(),
  mockDraftUpdate: vi.fn(),
  mockDraftFindUnique: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockGenerateDraftReply: vi.fn(),
  mockGetFullBusinessContext: vi.fn(),
  mockSendConversationMessage: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    conversation: {
      findFirst: mockConversationFindFirst,
      update: mockConversationUpdate,
    },
    draft: {
      upsert: mockDraftUpsert,
      update: mockDraftUpdate,
      findUnique: mockDraftFindUnique,
    },
    auditLog: {
      create: mockAuditCreate,
    },
  },
}))

let mockSession: unknown = null
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => mockSession),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/agent/context', () => ({
  getFullBusinessContext: mockGetFullBusinessContext,
}))

vi.mock('@/lib/ai/provider', () => ({
  generateDraftReply: mockGenerateDraftReply,
}))

vi.mock('@/lib/conversations/send-message', () => ({
  sendConversationMessage: mockSendConversationMessage,
}))

vi.mock('next/server', () => {
  class NextResponse {
    status: number
    body: unknown
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    async json() {
      return this.body
    }
    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(body, init)
    }
  }
  return { NextResponse }
})

import { POST as suggestDraft } from '@/app/api/conversations/[id]/draft/suggest/route'
import { PATCH as updateDraft } from '@/app/api/conversations/[id]/draft/route'
import { POST as sendApprovedDraft } from '@/app/api/conversations/[id]/draft/send-approved/route'

function makeReq(body: Record<string, unknown> = {}): { json: () => Promise<unknown> } {
  return { json: async () => body }
}

const emailConversation = {
  id: 'conv1',
  tenantId: 'tenant-A',
  channelId: 'channel1',
  externalThreadId: 'thread1',
  label: null,
  channel: { id: 'channel1', type: 'email', emailAddress: 'owner@example.com' },
  messages: [
    {
      direction: 'inbound',
      body: 'How much is Botox?',
      createdAt: new Date('2026-06-01T12:00:00Z'),
    },
  ],
}

describe('POST /api/conversations/[id]/draft/suggest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
  })

  it('returns 401 without a session', async () => {
    mockSession = null

    const res = await suggestDraft(makeReq() as never, { params: { id: 'conv1' } })

    expect(res.status).toBe(401)
  })

  it('blocks non-email conversations for the MVP', async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...emailConversation,
      channel: { type: 'sms' },
    })

    const res = await suggestDraft(makeReq() as never, { params: { id: 'conv1' } })

    expect(res.status).toBe(400)
    expect(mockGenerateDraftReply).not.toHaveBeenCalled()
  })

  it('upserts a proposed draft with AI metadata scoped to the session tenant', async () => {
    mockConversationFindFirst.mockResolvedValue(emailConversation)
    mockGetFullBusinessContext.mockResolvedValue({
      profile: { businessName: 'Glow Studio' },
      documents: [{ id: 'doc1', title: 'Pricing', content: 'Botox starts at $12/unit.' }],
    })
    mockGenerateDraftReply.mockResolvedValue({
      draftText: 'Thanks for reaching out. Botox starts at $12/unit.',
      intent: 'pricing',
      confidence: 0.91,
      riskLevel: 'low',
      suggestedLabel: 'Pricing',
      escalationReason: null,
      model: 'gpt-test',
    })
    mockDraftUpsert.mockResolvedValue({
      id: 'draft1',
      conversationId: 'conv1',
      text: 'Thanks for reaching out. Botox starts at $12/unit.',
      status: 'proposed',
      metadataJson: { intent: 'pricing' },
    })
    mockConversationUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})

    const res = await suggestDraft(makeReq() as never, { params: { id: 'conv1' } })

    expect(res.status).toBe(200)
    expect(mockConversationFindFirst.mock.calls[0][0].where).toMatchObject({
      id: 'conv1',
      tenantId: 'tenant-A',
    })
    expect(mockDraftUpsert).toHaveBeenCalledOnce()
    const upsertArg = mockDraftUpsert.mock.calls[0][0]
    expect(upsertArg.where).toEqual({ conversationId: 'conv1' })
    expect(upsertArg.create.status).toBe('proposed')
    expect(upsertArg.create.metadataJson).toMatchObject({
      intent: 'pricing',
      confidence: 0.91,
      riskLevel: 'low',
      suggestedLabel: 'Pricing',
      model: 'gpt-test',
    })
    expect(mockConversationUpdate).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: { label: 'Pricing' },
    })
    expect(mockAuditCreate.mock.calls[0][0].data).toMatchObject({
      tenantId: 'tenant-A',
      userId: 'user1',
      action: 'draft.suggest',
    })
  })
})

describe('PATCH /api/conversations/[id]/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockConversationFindFirst.mockResolvedValue(emailConversation)
    mockDraftUpdate.mockResolvedValue({ id: 'draft1', status: 'approved', text: 'Edited reply' })
    mockAuditCreate.mockResolvedValue({})
  })

  it('saves staff edits without trusting request tenant data', async () => {
    await updateDraft(makeReq({ text: ' Edited reply ', tenantId: 'tenant-B' }) as never, {
      params: { id: 'conv1' },
    })

    expect(mockDraftUpdate).toHaveBeenCalledWith({
      where: { conversationId: 'conv1' },
      data: { text: 'Edited reply', status: 'proposed' },
    })
  })

  it('can approve an existing draft', async () => {
    await updateDraft(makeReq({ status: 'approved' }) as never, { params: { id: 'conv1' } })

    expect(mockDraftUpdate.mock.calls[0][0].data).toEqual({ status: 'approved' })
    expect(mockAuditCreate.mock.calls[0][0].data.action).toBe('draft.approve')
  })
})

describe('POST /api/conversations/[id]/draft/send-approved', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockConversationFindFirst.mockResolvedValue(emailConversation)
    mockDraftFindUnique.mockResolvedValue({
      id: 'draft1',
      conversationId: 'conv1',
      text: 'Approved reply',
      status: 'proposed',
    })
    mockDraftUpdate.mockResolvedValue({})
    mockSendConversationMessage.mockResolvedValue({ ok: true, providerMessageId: 'gmail_123' })
    mockAuditCreate.mockResolvedValue({})
  })

  it('sends a human-approved draft through the shared send helper and marks it sent', async () => {
    const res = await sendApprovedDraft(makeReq() as never, { params: { id: 'conv1' } })

    expect(res.status).toBe(200)
    expect(mockSendConversationMessage).toHaveBeenCalledWith({
      conversationId: 'conv1',
      tenantId: 'tenant-A',
      userId: 'user1',
      text: 'Approved reply',
      auditAction: 'conversation.send',
    })
    expect(mockDraftUpdate).toHaveBeenCalledWith({
      where: { conversationId: 'conv1' },
      data: { status: 'sent' },
    })
  })
})
