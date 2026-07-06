import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ processWork: vi.fn() }))
vi.mock("@/lib/agent/job-executor", () => ({ processAgentJobWork: mocks.processWork }))

import { GET } from "@/app/api/cron/agent-jobs/route"

describe("Agent jobs cron", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mocks.processWork.mockResolvedValue({
      processed: 2,
      succeeded: 2,
      failed: 0,
      skippedStale: 0,
    })
  })

  it("rejects missing or invalid bearer authorization", async () => {
    const response = await GET(new Request("https://flowdesk.example/api/cron/agent-jobs"))
    expect(response.status).toBe(401)
    expect(mocks.processWork).not.toHaveBeenCalled()
  })

  it("rejects Bearer undefined when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET
    const response = await GET(new Request("https://flowdesk.example/api/cron/agent-jobs", {
      headers: { Authorization: "Bearer undefined" },
    }))
    expect(response.status).toBe(401)
    expect(mocks.processWork).not.toHaveBeenCalled()
  })

  it("drains bounded work for an authorized scheduler", async () => {
    const response = await GET(new Request("https://flowdesk.example/api/cron/agent-jobs", {
      headers: { Authorization: "Bearer cron-secret" },
    }))
    expect(response.status).toBe(200)
    expect(mocks.processWork).toHaveBeenCalledOnce()
    expect(await response.json()).toEqual({
      processed: 2,
      succeeded: 2,
      failed: 0,
      skippedStale: 0,
    })
    expect(response.headers.get("x-agent-jobs-errors")).toBe("0")
  })

  it("signals job failures to production monitoring", async () => {
    mocks.processWork.mockResolvedValue({
      processed: 3,
      succeeded: 1,
      failed: 2,
      skippedStale: 5,
    })
    const response = await GET(new Request("https://flowdesk.example/api/cron/agent-jobs", {
      headers: { Authorization: "Bearer cron-secret" },
    }))
    expect(response.status).toBe(500)
    expect(response.headers.get("x-agent-jobs-errors")).toBe("2")
  })
})
