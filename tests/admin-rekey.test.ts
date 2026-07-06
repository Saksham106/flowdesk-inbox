import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockPrisma, mockGetServerSession, mockReEncryptString } = vi.hoisted(() => {
  const credentialModel = () => ({ findMany: vi.fn(), update: vi.fn() })
  const mockPrisma = {
    gmailCredential: credentialModel(),
    googleCalendarCredential: credentialModel(),
    googleDriveCredential: credentialModel(),
    outlookCredential: credentialModel(),
    mindBodyCredential: credentialModel(),
  }
  return {
    mockPrisma,
    mockGetServerSession: vi.fn(),
    mockReEncryptString: vi.fn((value: string) => `rekeyed:${value}`),
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/crypto", () => ({ reEncryptString: mockReEncryptString }))

import { POST } from "@/app/api/admin/rekey/route"

describe("POST /api/admin/rekey", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1" } })
    for (const model of Object.values(mockPrisma)) {
      model.findMany.mockResolvedValue([])
      model.update.mockResolvedValue({})
    }
  })

  it("re-encrypts all four encrypted Outlook fields", async () => {
    mockPrisma.outlookCredential.findMany.mockResolvedValue([
      {
        id: "oc1",
        accessTokenEncrypted: "access",
        refreshTokenEncrypted: "refresh",
        deltaLinkEncrypted: "delta",
        subscriptionClientStateEncrypted: "client-state",
      },
    ])

    const res = await POST()
    const body = await res.json()

    expect(body).toEqual({ rekeyed: 1, errors: 0 })
    expect(mockPrisma.outlookCredential.update).toHaveBeenCalledWith({
      where: { id: "oc1" },
      data: {
        accessTokenEncrypted: "rekeyed:access",
        refreshTokenEncrypted: "rekeyed:refresh",
        deltaLinkEncrypted: "rekeyed:delta",
        subscriptionClientStateEncrypted: "rekeyed:client-state",
      },
    })
  })

  it("leaves unset optional Outlook fields untouched", async () => {
    mockPrisma.outlookCredential.findMany.mockResolvedValue([
      {
        id: "oc2",
        accessTokenEncrypted: "access",
        refreshTokenEncrypted: "refresh",
        deltaLinkEncrypted: null,
        subscriptionClientStateEncrypted: null,
      },
    ])

    const res = await POST()
    const body = await res.json()

    expect(body).toEqual({ rekeyed: 1, errors: 0 })
    expect(mockPrisma.outlookCredential.update).toHaveBeenCalledWith({
      where: { id: "oc2" },
      data: {
        accessTokenEncrypted: "rekeyed:access",
        refreshTokenEncrypted: "rekeyed:refresh",
        deltaLinkEncrypted: null,
        subscriptionClientStateEncrypted: null,
      },
    })
    expect(mockReEncryptString).not.toHaveBeenCalledWith(null)
  })
})
