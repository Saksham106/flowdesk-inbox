import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  channelFindFirst: vi.fn(),
  runDelta: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock("next-auth", () => ({ getServerSession: mocks.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: { channel: { findFirst: mocks.channelFindFirst } },
}))
vi.mock("@/lib/outlook-sync", () => ({ runOutlookDeltaSync: mocks.runDelta }))
vi.mock("@/lib/cache-tags", () => ({ revalidateInboxViews: mocks.revalidate }))

import { POST } from "@/app/api/connectors/outlook/sync/route"

describe("Outlook manual sync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { tenantId: "tenant-1" } })
    mocks.channelFindFirst.mockResolvedValue({ id: "channel-1" })
    mocks.runDelta.mockResolvedValue({
      ok: true,
      channelId: "channel-1",
      synced: 2,
      deleted: 1,
      pages: 1,
      hasMore: false,
      mode: "manual_delta",
    })
  })

  it("routes manual sync through the shared delta engine", async () => {
    const response = await POST(syncRequest())
    expect(response.status).toBe(200)
    expect(mocks.runDelta).toHaveBeenCalledWith({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    })
  })

  it("returns 202 when another delta worker holds the credential lease", async () => {
    mocks.runDelta.mockResolvedValue({
      ok: true,
      channelId: "channel-1",
      skipped: "sync_in_progress",
    })
    const response = await POST(syncRequest())
    expect(response.status).toBe(202)
  })
})

function syncRequest() {
  return new Request("https://flowdesk.example/api/connectors/outlook/sync", {
    method: "POST",
    body: JSON.stringify({ channelId: "channel-1" }),
  })
}
