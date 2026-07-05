import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockCredFindMany,
  mockCredUpdate,
  mockAuditCreate,
  mockRenewGmailWatchIfNeeded,
} = vi.hoisted(() => ({
  mockCredFindMany: vi.fn(),
  mockCredUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockRenewGmailWatchIfNeeded: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gmailCredential: {
      findMany: mockCredFindMany,
      update: mockCredUpdate,
    },
    auditLog: {
      create: mockAuditCreate,
    },
  },
}))

vi.mock("@/lib/google", () => ({
  renewGmailWatchIfNeeded: mockRenewGmailWatchIfNeeded,
  stopGmailWatch: vi.fn(),
}))

vi.mock("next/server", () => {
  class NextResponse {
    status: number
    body: unknown
    headers: Headers
    constructor(body: unknown, init?: { status?: number; headers?: HeadersInit }) {
      this.body = body
      this.status = init?.status ?? 200
      this.headers = new Headers(init?.headers)
    }
    async json() { return this.body }
    static json(body: unknown, init?: { status?: number; headers?: HeadersInit }) {
      return new NextResponse(body, init)
    }
  }
  return { NextResponse }
})

import { DELETE, GET } from "@/app/api/cron/gmail-watch/route"

function request() {
  return {
    headers: new Headers({ authorization: "Bearer cron-secret" }),
  } as Request
}

describe("GET /api/cron/gmail-watch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    process.env.GMAIL_PUSH_TOPIC = "projects/demo/topics/gmail"
    mockCredFindMany.mockResolvedValue([
      { channelId: "channel-ok", channel: { tenantId: "tenant-1" } },
      { channelId: "channel-fail", channel: { tenantId: "tenant-2" } },
    ])
    mockCredUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
  })

  it("records watch renewal health and returns 500 when any channel fails", async () => {
    mockRenewGmailWatchIfNeeded
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("pubsub permission denied"))

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ renewed: 1, errors: 1 })
    expect(res.headers.get("X-Gmail-Watch-Errors")).toBe("1")
    expect(mockCredUpdate).toHaveBeenCalledWith({
      where: { channelId: "channel-ok" },
      data: expect.objectContaining({
        watchLastRenewalAttempt: expect.any(Date),
        watchRenewalError: null,
      }),
    })
    expect(mockCredUpdate).toHaveBeenCalledWith({
      where: { channelId: "channel-fail" },
      data: expect.objectContaining({
        watchLastRenewalAttempt: expect.any(Date),
        watchRenewalError: "pubsub permission denied",
      }),
    })
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        action: "gmail_watch.renewal_attempt",
        payloadJson: expect.objectContaining({ channelId: "channel-ok", success: true }),
      }),
    })
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-2",
        action: "gmail_watch.renewal_failed",
        payloadJson: expect.objectContaining({
          channelId: "channel-fail",
          success: false,
          error: "pubsub permission denied",
        }),
      }),
    })
  })

  it("rejects Bearer undefined when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET

    const res = await GET({
      headers: new Headers({ authorization: "Bearer undefined" }),
    } as Request)

    expect(res.status).toBe(401)
    expect(mockCredFindMany).not.toHaveBeenCalled()
  })

  it("DELETE rejects Bearer undefined when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET

    const res = await DELETE({
      headers: new Headers({ authorization: "Bearer undefined" }),
    } as Request)

    expect(res.status).toBe(401)
    expect(mockCredUpdate).not.toHaveBeenCalled()
  })
})
