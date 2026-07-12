import { beforeEach, describe, expect, it, vi } from "vitest"

const { channelFindMany, conversationGroupBy, approvalCount, tenantFindUnique } = vi.hoisted(() => ({
  channelFindMany: vi.fn(),
  conversationGroupBy: vi.fn(),
  approvalCount: vi.fn(),
  tenantFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: { findMany: channelFindMany },
    conversation: { groupBy: conversationGroupBy },
    approvalRequest: { count: approvalCount },
    tenant: { findUnique: tenantFindUnique },
  },
}))

const { getAppShellContext } = await import("@/lib/app-shell")

describe("getAppShellContext account scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    channelFindMany
      .mockResolvedValueOnce([
        { id: "channel-a", emailAddress: "a@example.com", provider: "google" },
        { id: "channel-b", emailAddress: "b@example.com", provider: "microsoft" },
      ])
      // gmail sync-channel query, then the outlook sync-channel query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    conversationGroupBy.mockResolvedValue([])
    approvalCount.mockResolvedValue(0)
    tenantFindUnique.mockResolvedValue({ salesCrmEnabled: false })
  })

  it("scopes counts to a channel owned by the tenant", async () => {
    const result = await getAppShellContext("tenant-a", "channel-b")

    expect(result.activeChannelId).toBe("channel-b")
    expect(conversationGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-a", channelId: "channel-b" } })
    )
  })

  it("falls back to all accounts for an unknown channel id", async () => {
    const result = await getAppShellContext("tenant-a", "channel-other-tenant")

    expect(result.activeChannelId).toBeNull()
    expect(conversationGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-a" } })
    )
  })
})
