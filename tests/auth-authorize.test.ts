import { beforeEach, describe, expect, it, vi } from "vitest"
import bcrypt from "bcryptjs"

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}))

import { authOptions } from "@/lib/auth"

type AuthorizeFn = (
  credentials: Record<string, string> | undefined
) => Promise<unknown>

function getAuthorize(): AuthorizeFn {
  // next-auth v4 keeps the user-supplied authorize on provider.options; the
  // top-level authorize is the library default.
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: AuthorizeFn }
  }
  return provider.options.authorize.bind(provider.options)
}

describe("credentials authorize", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("returns null for an unknown email", async () => {
    mocks.userFindUnique.mockResolvedValue(null)
    const result = await getAuthorize()({
      email: "nobody@example.com",
      password: "whatever",
    })
    expect(result).toBeNull()
  })

  it("returns null for a wrong password", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      tenantId: "tenant-1",
      passwordHash: bcrypt.hashSync("correct-password", 4),
      tenant: { salesCrmEnabled: false },
    })
    const result = await getAuthorize()({
      email: "user@example.com",
      password: "wrong-password",
    })
    expect(result).toBeNull()
  })

  it("returns the session user for valid credentials", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      tenantId: "tenant-1",
      passwordHash: bcrypt.hashSync("correct-password", 4),
      tenant: { salesCrmEnabled: false },
    })
    const result = await getAuthorize()({
      email: "user@example.com",
      password: "correct-password",
    })
    expect(result).toMatchObject({ id: "user-1", tenantId: "tenant-1" })
  })

  it("throws an opaque error when the database is unreachable", async () => {
    mocks.userFindUnique.mockRejectedValue(
      new Error(
        "Invalid `prisma.user.findUnique()` invocation: Can't reach database server at `postgres.railway.internal:5432`"
      )
    )
    await expect(
      getAuthorize()({ email: "user@example.com", password: "whatever" })
    ).rejects.toThrow(/^service_unavailable$/)
  })
})
