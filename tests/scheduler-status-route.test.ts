import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockGetSchedulerStatus, mockIsSchedulerStarted } = vi.hoisted(() => ({
  mockGetSchedulerStatus: vi.fn(),
  mockIsSchedulerStarted: vi.fn(),
}))

vi.mock("@/lib/scheduler/run-scheduler", () => ({
  getSchedulerStatus: mockGetSchedulerStatus,
  isSchedulerStarted: mockIsSchedulerStarted,
}))

import { GET } from "@/app/api/admin/scheduler-status/route"

function request(auth?: string) {
  return { headers: new Headers(auth ? { authorization: auth } : {}) } as Request
}

describe("GET /api/admin/scheduler-status", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockIsSchedulerStarted.mockReturnValue(true)
    mockGetSchedulerStatus.mockReturnValue([
      { name: "agent-jobs", runCount: 5, errorCount: 0, lastError: null },
    ])
  })

  it("rejects requests without the cron secret", async () => {
    const res = await GET(request())
    expect(res.status).toBe(401)
  })

  it("rejects Bearer undefined when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET
    const res = await GET(request("Bearer undefined"))
    expect(res.status).toBe(401)
  })

  it("returns scheduler status when authorized", async () => {
    const res = await GET(request("Bearer cron-secret"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.started).toBe(true)
    expect(body.jobs).toEqual([{ name: "agent-jobs", runCount: 5, errorCount: 0, lastError: null }])
  })
})
