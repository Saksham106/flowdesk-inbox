import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: { findMany: vi.fn() },
    snippet: { findMany: vi.fn(), upsert: vi.fn() },
  },
}))

import { mineSnippets } from "@/lib/agent/snippet-miner"
import { prisma } from "@/lib/prisma"

const mockMessages = vi.mocked(prisma.message.findMany)
const mockSnippetFindMany = vi.mocked(prisma.snippet.findMany)
const mockUpsert = vi.mocked(prisma.snippet.upsert)

describe("mineSnippets", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it("extracts repeated greeting patterns", async () => {
    mockMessages.mockResolvedValueOnce([
      { id: "m1", body: "Hi there, thanks for reaching out! Let me check on that for you." },
      { id: "m2", body: "Hi there, thanks for reaching out! I will get back to you shortly." },
      { id: "m3", body: "Hi there, thanks for reaching out! Here is what I found." },
    ] as never)
    mockSnippetFindMany.mockResolvedValueOnce([] as never)
    mockUpsert.mockResolvedValue({} as never)

    await mineSnippets("tenant1")
    expect(mockUpsert).toHaveBeenCalled()
  })

  it("skips patterns appearing fewer than 3 times", async () => {
    mockMessages.mockResolvedValueOnce([
      { id: "m1", body: "Unique response that nobody else would write." },
    ] as never)
    mockSnippetFindMany.mockResolvedValueOnce([] as never)

    await mineSnippets("tenant1")
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
