import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFindUnique = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockUpsert = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    openRouterUserKey: {
      findUnique: mockFindUnique,
      create: mockCreate,
      update: mockUpdate,
      upsert: mockUpsert,
    },
  },
}))

vi.mock("@/lib/crypto", () => ({
  encryptString: (value: string) => `enc:${value}`,
  decryptString: (value: string) => value.replace(/^enc:/, ""),
}))

describe("getOpenRouterApiKeyForUser", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.OPENROUTER_MANAGEMENT_API_KEY = "mgmt"
    process.env.OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD = "10"
    delete process.env.OPENROUTER_WORKSPACE_ID
  })

  it("returns an existing active child key", async () => {
    mockFindUnique.mockResolvedValue({
      encryptedApiKey: "enc:sk-or-user",
      keyHash: "hash1",
      disabled: false,
    })
    const { getOpenRouterApiKeyForUser } = await import("@/lib/ai/openrouter-keys")
    await expect(getOpenRouterApiKeyForUser({ tenantId: "t1", userId: "u1", email: "a@example.com" }))
      .resolves.toMatchObject({ apiKey: "sk-or-user", keyHash: "hash1" })
  })

  it("provisions and stores a child key when missing", async () => {
    mockFindUnique.mockResolvedValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "sk-or-new", hash: "hash2", label: "sk-or-v1-new" }),
    }))
    mockUpsert.mockResolvedValue({ encryptedApiKey: "enc:sk-or-new", keyHash: "hash2", disabled: false })

    const { getOpenRouterApiKeyForUser } = await import("@/lib/ai/openrouter-keys")
    const key = await getOpenRouterApiKeyForUser({ tenantId: "t1", userId: "u1", email: "a@example.com" })

    expect(key).toMatchObject({ apiKey: "sk-or-new", keyHash: "hash2" })
    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/keys",
      expect.objectContaining({ method: "POST" })
    )
    const requestBody = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(requestBody.name).toBe("flowdesk-a-u1")
    expect(requestBody).not.toHaveProperty("workspace_id")
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        create: expect.objectContaining({ userId: "u1", keyHash: "hash2" }),
        update: expect.objectContaining({ keyHash: "hash2", disabled: false }),
      })
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("defaults the monthly limit to $3 when OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD is unset", async () => {
    delete process.env.OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD
    mockFindUnique.mockResolvedValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "sk-or-new", hash: "hash2", label: "sk-or-v1-new" }),
    }))
    mockUpsert.mockResolvedValue({ encryptedApiKey: "enc:sk-or-new", keyHash: "hash2", disabled: false })

    const { getOpenRouterApiKeyForUser } = await import("@/lib/ai/openrouter-keys")
    await getOpenRouterApiKeyForUser({ tenantId: "t1", userId: "u1", email: "a@example.com" })

    const requestBody = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(requestBody.limit).toBe(3)
    expect(requestBody.limit_reset).toBe("monthly")
  })

  it("includes workspace_id in the provisioning request when OPENROUTER_WORKSPACE_ID is configured", async () => {
    process.env.OPENROUTER_WORKSPACE_ID = "ws-abc-123"
    mockFindUnique.mockResolvedValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "sk-or-new", hash: "hash2", label: "sk-or-v1-new" }),
    }))
    mockUpsert.mockResolvedValue({ encryptedApiKey: "enc:sk-or-new", keyHash: "hash2", disabled: false })

    const { getOpenRouterApiKeyForUser } = await import("@/lib/ai/openrouter-keys")
    await getOpenRouterApiKeyForUser({ tenantId: "t1", userId: "u1", email: "a@example.com" })

    const requestBody = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(requestBody.workspace_id).toBe("ws-abc-123")
  })

  it("re-provisions and upserts (not create) when the existing row is disabled", async () => {
    mockFindUnique.mockResolvedValue({
      encryptedApiKey: "enc:sk-or-old",
      keyHash: "hash-old",
      disabled: true,
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "sk-or-fresh", hash: "hash-fresh", label: "sk-or-v1-fresh" }),
    }))
    mockUpsert.mockResolvedValue({ encryptedApiKey: "enc:sk-or-fresh", keyHash: "hash-fresh", disabled: false })

    const { getOpenRouterApiKeyForUser } = await import("@/lib/ai/openrouter-keys")
    const key = await getOpenRouterApiKeyForUser({ tenantId: "t1", userId: "u1", email: "a@example.com" })

    expect(key).toMatchObject({ apiKey: "sk-or-fresh", keyHash: "hash-fresh" })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        update: expect.objectContaining({
          keyHash: "hash-fresh",
          disabled: false,
          lastError: null,
        }),
      })
    )
  })

  it("fails closed in production with no management key and no existing user key", async () => {
    vi.stubEnv("NODE_ENV", "production")
    delete process.env.OPENROUTER_MANAGEMENT_API_KEY
    delete process.env.OPENROUTER_API_KEY
    mockFindUnique.mockResolvedValue(null)

    try {
      const { getOpenRouterApiKeyForUser } = await import("@/lib/ai/openrouter-keys")
      await expect(
        getOpenRouterApiKeyForUser({ tenantId: "t1", userId: "u1", email: "a@example.com" })
      ).rejects.toThrow()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe("buildOpenRouterKeyName", () => {
  it("derives a readable name from the email local part and userId", async () => {
    const { buildOpenRouterKeyName } = await import("@/lib/ai/openrouter-keys")
    expect(buildOpenRouterKeyName("john.doe@gmail.com", "cljk3x9m2000008l5abcd123"))
      .toBe("flowdesk-johndoe-bcd123")
  })

  it("strips non-alphanumeric characters and lowercases the local part", async () => {
    const { buildOpenRouterKeyName } = await import("@/lib/ai/openrouter-keys")
    expect(buildOpenRouterKeyName("Jane+Test_99@example.com", "u2")).toBe("flowdesk-janetest99-u2")
  })

  it("falls back to 'user' when the local part has no usable characters", async () => {
    const { buildOpenRouterKeyName } = await import("@/lib/ai/openrouter-keys")
    expect(buildOpenRouterKeyName("@example.com", "u3")).toBe("flowdesk-user-u3")
  })
})
