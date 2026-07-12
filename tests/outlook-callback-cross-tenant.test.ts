import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockChannelFindUnique,
  mockChannelCreate,
  mockCredentialUpdate,
  mockDeltaSync,
  mockEnsureSubscription,
  mockEnsureCategories,
} = vi.hoisted(() => ({
  mockChannelFindUnique: vi.fn(),
  mockChannelCreate: vi.fn(),
  mockCredentialUpdate: vi.fn(),
  mockDeltaSync: vi.fn(),
  mockEnsureSubscription: vi.fn(),
  mockEnsureCategories: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: { findUnique: mockChannelFindUnique, create: mockChannelCreate },
    outlookCredential: { update: mockCredentialUpdate },
  },
}))
vi.mock("@/lib/crypto", () => ({ encryptString: (s: string) => `enc:${s}` }))
vi.mock("@/lib/microsoft", () => ({
  verifyOutlookState: vi.fn().mockReturnValue("tenant-session"),
  exchangeOutlookCode: vi.fn().mockResolvedValue({
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: new Date("2026-07-13T00:00:00Z"),
  }),
  getOutlookUserEmail: vi.fn().mockResolvedValue("someone@outlook.com"),
}))
vi.mock("@/lib/outlook-sync", () => ({ runOutlookDeltaSync: mockDeltaSync }))
vi.mock("@/lib/outlook-subscriptions", () => ({ ensureOutlookSubscription: mockEnsureSubscription }))
vi.mock("@/lib/outlook-mailbox", () => ({ ensureFlowDeskCategories: mockEnsureCategories }))

import { GET } from "@/app/api/connectors/outlook/callback/route"

function callbackRequest() {
  return new Request("https://app.test/api/connectors/outlook/callback?code=c&state=s")
}

describe("Outlook OAuth callback cross-tenant guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXTAUTH_URL = "https://app.test"
    mockDeltaSync.mockResolvedValue({ ok: true })
    mockEnsureSubscription.mockResolvedValue(undefined)
    mockEnsureCategories.mockResolvedValue(undefined)
  })

  it("rejects a mailbox already connected to another tenant without touching its credential", async () => {
    // Regression: the callback used to silently refresh the OTHER tenant's
    // credential (observed live 2026-07-12 — a user's connect re-armed the
    // original dev tenant's channel and their own tenant got nothing).
    mockChannelFindUnique.mockResolvedValue({ id: "chan-1", tenantId: "tenant-other" })

    const response = await GET(callbackRequest())

    expect(response.headers.get("location")).toBe(
      "https://app.test/settings/connect?error=account_already_connected"
    )
    expect(mockCredentialUpdate).not.toHaveBeenCalled()
    expect(mockDeltaSync).not.toHaveBeenCalled()
    expect(mockEnsureSubscription).not.toHaveBeenCalled()
  })

  it("refreshes the credential in place for a same-tenant reconnect", async () => {
    mockChannelFindUnique.mockResolvedValue({ id: "chan-1", tenantId: "tenant-session" })

    const response = await GET(callbackRequest())

    expect(mockCredentialUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channelId: "chan-1" } })
    )
    expect(response.headers.get("location")).not.toContain("error=")
  })

  it("creates a channel under the connecting tenant for a new mailbox", async () => {
    mockChannelFindUnique.mockResolvedValue(null)
    mockChannelCreate.mockResolvedValue({ id: "chan-new" })

    await GET(callbackRequest())

    expect(mockChannelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: "tenant-session", provider: "microsoft" }),
      })
    )
  })
})
