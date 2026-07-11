import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockWritebackFindUnique, mockApplyCore } = vi.hoisted(() => ({
  mockWritebackFindUnique: vi.fn(),
  mockApplyCore: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailWritebackQueue: { findUnique: mockWritebackFindUnique },
  },
}))

vi.mock("@/lib/agent/label-feedback-core", () => ({
  applyLabelFeedbackCore: mockApplyCore,
}))

import { applyOutlookCategoryFeedback } from "@/lib/agent/outlook-category-feedback"

function settledJob(labels: string[], updatedAt = new Date("2026-06-24T11:00:00.000Z")) {
  return {
    status: "completed",
    providerMessageIdsJson: { threadId: "graph-thread-1", labels },
    updatedAt,
  }
}

describe("applyOutlookCategoryFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyCore.mockResolvedValue({ applied: true, kind: "addition" })
  })

  it("diffs added FlowDesk categories against the settled projection", async () => {
    mockWritebackFindUnique.mockResolvedValue(settledJob(["Needs Reply"]))

    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Needs Reply", "Handled", "Custom"],
      })
    ).resolves.toEqual({ applied: true })

    expect(mockApplyCore).toHaveBeenCalledWith({
      tenantId: "t1",
      conversationId: "c1",
      added: ["Handled"],
      removed: [],
      auditAction: "outlook.labels.corrected",
    })
  })

  it("diffs removed FlowDesk categories against the settled projection", async () => {
    mockWritebackFindUnique.mockResolvedValue(settledJob(["Needs Reply"]))

    await applyOutlookCategoryFeedback({
      tenantId: "t1",
      conversationId: "c1",
      messageCategories: ["Custom"],
    })

    expect(mockApplyCore).toHaveBeenCalledWith(
      expect.objectContaining({ added: [], removed: ["Needs Reply"] })
    )
  })

  it("does not run while the projection job is still pending", async () => {
    mockWritebackFindUnique.mockResolvedValue({
      status: "pending",
      providerMessageIdsJson: { threadId: "graph-thread-1", labels: ["Needs Reply"] },
    })

    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Custom"],
      })
    ).resolves.toEqual({ applied: false })
    expect(mockApplyCore).not.toHaveBeenCalled()
  })

  it("does not run when FlowDesk never projected labels for the thread", async () => {
    mockWritebackFindUnique.mockResolvedValue(null)

    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Needs Reply"],
      })
    ).resolves.toEqual({ applied: false })
    expect(mockApplyCore).not.toHaveBeenCalled()
  })

  it("skips feedback when the projection job was rewritten during the same run", async () => {
    // Job settled at 12:00, but the delta run started at 11:00 — the payload we
    // would diff against post-dates the snapshot and can't be trusted.
    mockWritebackFindUnique.mockResolvedValue(
      settledJob(["Needs Reply"], new Date("2026-06-24T12:00:00.000Z"))
    )

    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Custom"],
        jobNotUpdatedSince: new Date("2026-06-24T11:00:00.000Z"),
      })
    ).resolves.toEqual({ applied: false })
    expect(mockApplyCore).not.toHaveBeenCalled()
  })

  it("applies feedback when the job settled before the run began", async () => {
    // Job settled at 11:00, run started at 12:00 — snapshot is trustworthy.
    mockWritebackFindUnique.mockResolvedValue(
      settledJob(["Needs Reply"], new Date("2026-06-24T11:00:00.000Z"))
    )

    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Custom"],
        jobNotUpdatedSince: new Date("2026-06-24T12:00:00.000Z"),
      })
    ).resolves.toEqual({ applied: true })
    expect(mockApplyCore).toHaveBeenCalledWith(
      expect.objectContaining({ added: [], removed: ["Needs Reply"] })
    )
  })

  it("does not run when the mailbox categories already match the projection", async () => {
    mockWritebackFindUnique.mockResolvedValue(settledJob(["Needs Reply"]))

    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Needs Reply", "Custom"],
      })
    ).resolves.toEqual({ applied: false })
    expect(mockApplyCore).not.toHaveBeenCalled()
  })
})
