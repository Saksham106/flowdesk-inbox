import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ processWork: vi.fn() }))
vi.mock("@/lib/outlook-worker", () => ({ processOutlookSyncWork: mocks.processWork }))

import { GET } from "@/app/api/cron/outlook-sync/route"

describe("Outlook sync cron", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mocks.processWork.mockResolvedValue({
      completedEvents: 1,
      deferredEvents: 0,
      renewed: 0,
      fallbackSyncs: 1,
      errors: 0,
    })
  })

  it("rejects missing or invalid bearer authorization", async () => {
    const response = await GET(new Request("https://flowdesk.example/api/cron/outlook-sync"))
    expect(response.status).toBe(401)
    expect(mocks.processWork).not.toHaveBeenCalled()
  })

  it("runs bounded work for an authorized scheduler", async () => {
    const response = await GET(new Request("https://flowdesk.example/api/cron/outlook-sync", {
      headers: { Authorization: "Bearer cron-secret" },
    }))
    expect(response.status).toBe(200)
    expect(mocks.processWork).toHaveBeenCalledOnce()
  })

  it("signals processing failures to production monitoring", async () => {
    mocks.processWork.mockResolvedValue({
      completedEvents: 0,
      deferredEvents: 1,
      renewed: 0,
      fallbackSyncs: 0,
      errors: 1,
    })
    const response = await GET(new Request("https://flowdesk.example/api/cron/outlook-sync", {
      headers: { Authorization: "Bearer cron-secret" },
    }))
    expect(response.status).toBe(500)
    expect(response.headers.get("x-outlook-sync-errors")).toBe("1")
  })
})
