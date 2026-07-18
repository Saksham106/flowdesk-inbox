import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockAuditDeleteMany, mockUsageDeleteMany, mockPushDeleteMany, mockOutlookDeleteMany, mockWritebackDeleteMany } = vi.hoisted(() => ({
  mockAuditDeleteMany: vi.fn(),
  mockUsageDeleteMany: vi.fn(),
  mockPushDeleteMany: vi.fn(),
  mockOutlookDeleteMany: vi.fn(),
  mockWritebackDeleteMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { deleteMany: mockAuditDeleteMany },
    aiUsageEvent: { deleteMany: mockUsageDeleteMany },
    gmailPushEvent: { deleteMany: mockPushDeleteMany },
    outlookSyncEvent: { deleteMany: mockOutlookDeleteMany },
    emailWritebackQueue: { deleteMany: mockWritebackDeleteMany },
  },
}))

import { runDataRetentionCron } from "@/lib/agent/data-retention"

const NOW = new Date("2026-07-13T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

describe("runDataRetentionCron", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockAuditDeleteMany.mockResolvedValue({ count: 0 })
    mockUsageDeleteMany.mockResolvedValue({ count: 0 })
    mockPushDeleteMany.mockResolvedValue({ count: 0 })
    mockOutlookDeleteMany.mockResolvedValue({ count: 0 })
    mockWritebackDeleteMany.mockResolvedValue({ count: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("deletes audit logs older than 30 days", async () => {
    await runDataRetentionCron()
    expect(mockAuditDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(NOW.getTime() - 30 * DAY) } },
    })
  })

  it("deletes AI usage events older than 90 days so monthly budget windows stay intact", async () => {
    await runDataRetentionCron()
    expect(mockUsageDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(NOW.getTime() - 90 * DAY) } },
    })
  })

  it("deletes Gmail push events older than 30 days", async () => {
    await runDataRetentionCron()
    expect(mockPushDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(NOW.getTime() - 30 * DAY) } },
    })
  })

  it("deletes Outlook sync events older than 30 days", async () => {
    await runDataRetentionCron()
    expect(mockOutlookDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(NOW.getTime() - 30 * DAY) } },
    })
  })

  it("deletes only FAILED writeback jobs, by updatedAt, after 7 days", async () => {
    await runDataRetentionCron()
    expect(mockWritebackDeleteMany).toHaveBeenCalledWith({
      where: { status: "failed", updatedAt: { lt: new Date(NOW.getTime() - 7 * DAY) } },
    })
    // Completed/acknowledged rows feed the label echo-suppression check and
    // must never be swept by retention — the status filter is the guarantee.
    const where = mockWritebackDeleteMany.mock.calls[0][0].where
    expect(where.status).toBe("failed")
  })

  it("reports how many rows each table dropped", async () => {
    mockAuditDeleteMany.mockResolvedValue({ count: 12 })
    mockUsageDeleteMany.mockResolvedValue({ count: 3 })
    mockPushDeleteMany.mockResolvedValue({ count: 7 })
    mockOutlookDeleteMany.mockResolvedValue({ count: 5 })
    mockWritebackDeleteMany.mockResolvedValue({ count: 33 })

    const result = await runDataRetentionCron()

    expect(result).toEqual({
      ok: true,
      auditLogsDeleted: 12,
      aiUsageEventsDeleted: 3,
      gmailPushEventsDeleted: 7,
      outlookSyncEventsDeleted: 5,
      failedWritebackJobsDeleted: 33,
    })
  })
})
