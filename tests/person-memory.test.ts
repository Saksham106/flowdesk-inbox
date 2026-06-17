import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockContactFindFirst,
  mockPersonMemoryFindUnique,
  mockPersonMemoryUpsert,
  mockAuditCreate,
  mockAiUsageCreate,
  mockOpenAiCreate,
  mockCheckAiBudgetForTokens,
} = vi.hoisted(() => ({
  mockContactFindFirst: vi.fn(),
  mockPersonMemoryFindUnique: vi.fn(),
  mockPersonMemoryUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockAiUsageCreate: vi.fn(),
  mockOpenAiCreate: vi.fn(),
  mockCheckAiBudgetForTokens: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findFirst: mockContactFindFirst },
    personMemory: { findUnique: mockPersonMemoryFindUnique, upsert: mockPersonMemoryUpsert },
    auditLog: { create: mockAuditCreate },
    aiUsageEvent: { create: mockAiUsageCreate },
  },
}))

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    responses: { create: mockOpenAiCreate },
  })),
}))

vi.mock("@/lib/ai/budget", () => ({
  checkAiBudgetForTokens: mockCheckAiBudgetForTokens,
  estimateCostUsd: () => 0.01,
}))

import {
  buildPersonMemoryContentHash,
  syncPersonMemoryWithLLM,
} from "@/lib/agent/person-memory"

const now = new Date("2026-06-15T12:00:00.000Z")
const contact = {
  id: "contact-1",
  tenantId: "tenant-1",
  name: "Alice",
  conversations: [
    {
      id: "conv-1",
      lastMessageAt: now,
      messages: [
        { direction: "inbound", body: "Could you send the proposal?", createdAt: new Date("2026-06-15T10:00:00.000Z") },
        { direction: "outbound", body: "I'll send it today.", createdAt: new Date("2026-06-15T10:05:00.000Z") },
        { direction: "inbound", body: "Thanks, I prefer concise updates.", createdAt: now },
      ],
    },
  ],
}

describe("person memory AI cache", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = "test-key"
    process.env.OPENAI_MODEL = "gpt-test"
    mockContactFindFirst.mockResolvedValue(contact)
    mockPersonMemoryFindUnique.mockResolvedValue(null)
    mockPersonMemoryUpsert.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockAiUsageCreate.mockResolvedValue({})
    mockOpenAiCreate.mockResolvedValue({
      output_text: JSON.stringify({
        summary: "Alice is discussing a proposal.",
        preferences: "Prefers concise updates.",
        openQuestions: null,
        promisedActions: "Send the proposal.",
      }),
    })
    mockCheckAiBudgetForTokens.mockResolvedValue({ allowed: true, reason: "Within budget" })
  })

  it("builds a stable hash from cleaned message content", () => {
    const hashA = buildPersonMemoryContentHash([
      { direction: "inbound", body: "<p>Hello&nbsp;there</p>", createdAt: now },
    ])
    const hashB = buildPersonMemoryContentHash([
      { direction: "inbound", body: "Hello there", createdAt: now },
    ])

    expect(hashA).toBe(hashB)
    expect(hashA).toMatch(/^[a-f0-9]{64}$/)
  })

  it("returns cache_hit and avoids OpenAI when the content hash has not changed", async () => {
    const contentHash = buildPersonMemoryContentHash(
      contact.conversations.flatMap((conversation) => conversation.messages)
    )
    mockPersonMemoryFindUnique.mockResolvedValue({
      id: "memory-1",
      contentHash,
      source: "llm",
    })

    const result = await syncPersonMemoryWithLLM("tenant-1", "contact-1")

    expect(result.status).toBe("cache_hit")
    expect(mockOpenAiCreate).not.toHaveBeenCalled()
    expect(mockAiUsageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feature: "person_memory.cache_hit",
          status: "skipped",
        }),
      })
    )
  })

  it("calls OpenAI and stores cache metadata when content changed", async () => {
    const result = await syncPersonMemoryWithLLM("tenant-1", "contact-1")

    expect(result.status).toBe("llm_completed")
    expect(mockOpenAiCreate).toHaveBeenCalledOnce()
    expect(mockPersonMemoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: "llm",
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          model: "gpt-test",
          llmSyncedAt: expect.any(Date),
        }),
        update: expect.objectContaining({
          source: "llm",
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          model: "gpt-test",
          llmSyncedAt: expect.any(Date),
        }),
      })
    )
  })

  it("returns llm_failed without calling OpenAI when AI budget would be exceeded", async () => {
    mockCheckAiBudgetForTokens.mockResolvedValue({
      allowed: false,
      reason: "Daily AI spend limit reached",
    })

    const result = await syncPersonMemoryWithLLM("tenant-1", "contact-1")

    expect(result.status).toBe("llm_failed")
    if (result.status === "llm_failed") {
      expect(result.reason).toBe("Daily AI spend limit reached")
    }
    expect(mockOpenAiCreate).not.toHaveBeenCalled()
    expect(mockAiUsageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feature: "person_memory.llm",
          status: "blocked",
        }),
      })
    )
  })
})
