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

function settledJob(labels: string[]) {
  return {
    status: "completed",
    providerMessageIdsJson: { threadId: "graph-thread-1", labels },
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
