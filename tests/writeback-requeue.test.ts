import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockUpdateMany, mockAuditCreate } = vi.hoisted(() => ({
  mockUpdateMany: vi.fn(),
  mockAuditCreate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailWritebackQueue: { updateMany: mockUpdateMany },
    auditLog: { create: mockAuditCreate },
  },
}))

import { requeueFailedWritebacksForChannel } from "@/lib/email/writeback-requeue"

describe("requeueFailedWritebacksForChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuditCreate.mockResolvedValue({})
  })

  it("flips failed jobs back to pending with a fresh attempt budget", async () => {
    mockUpdateMany.mockResolvedValue({ count: 5 })
    const count = await requeueFailedWritebacksForChannel("chan-1", "tenant-1", "gmail")
    expect(count).toBe(5)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { channelId: "chan-1", tenantId: "tenant-1", status: "failed" },
      data: {
        status: "pending",
        attempts: 0,
        lastError: null,
        nextAttemptAt: expect.any(Date),
      },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        action: "gmail.writeback.requeued",
        payloadJson: { channelId: "chan-1", count: 5, source: "oauth_reconnect" },
      },
    })
  })

  it("writes no audit row when there is nothing to requeue", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })
    const count = await requeueFailedWritebacksForChannel("chan-1", "tenant-1", "gmail")
    expect(count).toBe(0)
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })

  it("uses the outlook audit prefix for outlook channels", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await requeueFailedWritebacksForChannel("chan-2", "tenant-1", "outlook")
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "outlook.writeback.requeued" }),
      })
    )
  })

  it("is best-effort: a database error returns 0 instead of throwing", async () => {
    mockUpdateMany.mockRejectedValue(new Error("db down"))
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const count = await requeueFailedWritebacksForChannel("chan-1", "tenant-1", "gmail")
    expect(count).toBe(0)
    consoleSpy.mockRestore()
  })
})
