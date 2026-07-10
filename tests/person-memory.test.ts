import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockContactFindFirst,
  mockUserFindFirst,
  mockPersonMemoryFindUnique,
  mockPersonMemoryUpsert,
  mockAuditCreate,
  mockAiUsageCreate,
  mockRunAiJsonFeature,
} = vi.hoisted(() => ({
  mockContactFindFirst: vi.fn(),
  mockUserFindFirst: vi.fn(),
  mockPersonMemoryFindUnique: vi.fn(),
  mockPersonMemoryUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockAiUsageCreate: vi.fn(),
  mockRunAiJsonFeature: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findFirst: mockContactFindFirst },
    user: { findFirst: mockUserFindFirst },
    personMemory: { findUnique: mockPersonMemoryFindUnique, upsert: mockPersonMemoryUpsert },
    auditLog: { create: mockAuditCreate },
    aiUsageEvent: { create: mockAiUsageCreate },
  },
}))

vi.mock("@/lib/ai/gateway", () => ({
  runAiJsonFeature: mockRunAiJsonFeature,
}))

import {
  buildPersonMemoryContentHash,
  syncPersonMemoryWithLLM,
} from "@/lib/agent/person-memory"

const now = new Date("2026-06-15T12:00:00.000Z")
const owner = { id: "owner-1", email: "owner@example.com" }
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
    mockUserFindFirst.mockResolvedValue(owner)
    mockContactFindFirst.mockResolvedValue(contact)
    mockPersonMemoryFindUnique.mockResolvedValue(null)
    mockPersonMemoryUpsert.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockAiUsageCreate.mockResolvedValue({})
    mockRunAiJsonFeature.mockResolvedValue({
      output: {
        summary: "Alice is discussing a proposal.",
        preferences: "Prefers concise updates.",
        openQuestions: null,
        promisedActions: "Send the proposal.",
      },
      model: "anthropic/claude-sonnet-4.5",
      providerGenerationId: "gen-1",
    })
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

  it("returns cache_hit and avoids the AI gateway when the content hash has not changed", async () => {
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
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
    expect(mockAiUsageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feature: "person_memory.cache_hit",
          status: "skipped",
        }),
      })
    )
  })

  it("calls the AI gateway and stores cache metadata when content changed", async () => {
    const result = await syncPersonMemoryWithLLM("tenant-1", "contact-1")

    expect(result.status).toBe("llm_completed")
    expect(mockRunAiJsonFeature).toHaveBeenCalledOnce()
    expect(mockRunAiJsonFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: owner.id,
        userEmail: owner.email,
        feature: "person_memory.llm",
      })
    )
    expect(mockPersonMemoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: "llm",
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          model: "anthropic/claude-sonnet-4.5",
          llmSyncedAt: expect.any(Date),
        }),
        update: expect.objectContaining({
          source: "llm",
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          model: "anthropic/claude-sonnet-4.5",
          llmSyncedAt: expect.any(Date),
        }),
      })
    )
  })

  it("uses a dynamic feature key when featureContext is provided", async () => {
    await syncPersonMemoryWithLLM("tenant-1", "contact-1", { featureContext: "onboarding" })

    expect(mockRunAiJsonFeature).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "person_memory.onboarding" })
    )
  })

  it("returns llm_failed without calling the AI gateway when the tenant has no user", async () => {
    mockUserFindFirst.mockResolvedValue(null)

    const result = await syncPersonMemoryWithLLM("tenant-1", "contact-1")

    expect(result.status).toBe("deterministic")
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
    expect(mockAiUsageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feature: "person_memory.deterministic_fallback",
          status: "skipped",
        }),
      })
    )
  })

  it("falls back to a deterministic summary when the AI gateway throws (e.g. budget exceeded)", async () => {
    mockRunAiJsonFeature.mockRejectedValue(new Error("Daily AI spend limit reached"))

    const result = await syncPersonMemoryWithLLM("tenant-1", "contact-1")

    expect(result.status).toBe("llm_failed")
    if (result.status === "llm_failed") {
      expect(result.reason).toBe("Daily AI spend limit reached")
    }
    // Falls back to the deterministic summary rather than leaving no memory.
    expect(mockPersonMemoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ source: "deterministic" }),
      })
    )
  })
})
