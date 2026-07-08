import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFindMany, mockReminderUpdate, mockStateFindUnique, mockStateUpdate } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockReminderUpdate: vi.fn(),
  mockStateFindUnique: vi.fn(),
  mockStateUpdate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    snoozeReminder: { findMany: mockFindMany, update: mockReminderUpdate },
    conversationState: { findUnique: mockStateFindUnique, update: mockStateUpdate },
  },
}))

import { runSnoozeCheckCron } from "@/lib/agent/snooze-check"

describe("runSnoozeCheckCron", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReminderUpdate.mockResolvedValue({})
    mockStateUpdate.mockResolvedValue({})
  })

  it("does nothing when no snoozes are due", async () => {
    mockFindMany.mockResolvedValueOnce([])
    const result = await runSnoozeCheckCron()
    expect(result).toEqual({ ok: true, fired: 0 })
    expect(mockReminderUpdate).not.toHaveBeenCalled()
  })

  it("fires due snoozes and restores the pre-snooze priority", async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: "s1", conversationId: "c1", tenantId: "t1" },
    ])
    mockStateFindUnique.mockResolvedValueOnce({
      metadataJson: { preSnoozePriority: "urgent", snoozeReminderId: "s1" },
    })

    const result = await runSnoozeCheckCron()

    expect(result).toEqual({ ok: true, fired: 1 })
    expect(mockReminderUpdate).toHaveBeenCalledWith({ where: { id: "s1" }, data: { status: "fired" } })
    expect(mockStateUpdate).toHaveBeenCalledWith({
      where: { conversationId: "c1" },
      data: {
        priority: "urgent",
        metadataJson: expect.objectContaining({
          resurfacedFromSnooze: true,
          snoozeReminderId: null,
          preSnoozePriority: null,
        }),
      },
    })
  })

  it("falls back to medium priority when the stored priority is invalid", async () => {
    mockFindMany.mockResolvedValueOnce([{ id: "s1", conversationId: "c1", tenantId: "t1" }])
    mockStateFindUnique.mockResolvedValueOnce({ metadataJson: { preSnoozePriority: "not-a-real-priority" } })

    await runSnoozeCheckCron()

    expect(mockStateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priority: "medium" }) })
    )
  })
})
