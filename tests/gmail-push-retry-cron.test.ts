import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockPushEventFindMany, mockPushEventUpdate, mockRunGmailSync } = vi.hoisted(() => ({
  mockPushEventFindMany: vi.fn(),
  mockPushEventUpdate: vi.fn(),
  mockRunGmailSync: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gmailPushEvent: {
      findMany: mockPushEventFindMany,
      update: mockPushEventUpdate,
    },
  },
}))

vi.mock("@/lib/gmail-sync", () => ({
  runGmailSync: mockRunGmailSync,
}))

import { GET } from "@/app/api/cron/gmail-push-retry/route"

describe("GET /api/cron/gmail-push-retry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockPushEventFindMany.mockResolvedValue([])
    mockPushEventUpdate.mockResolvedValue({})
  })

  it("accepts the configured cron secret", async () => {
    const res = await GET({
      headers: new Headers({ authorization: "Bearer cron-secret" }),
    } as Request)

    expect(res.status).toBe(200)
    expect(mockPushEventFindMany).toHaveBeenCalled()
  })

  it("rejects Bearer undefined when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET

    const res = await GET({
      headers: new Headers({ authorization: "Bearer undefined" }),
    } as Request)

    expect(res.status).toBe(401)
    expect(mockPushEventFindMany).not.toHaveBeenCalled()
  })
})
