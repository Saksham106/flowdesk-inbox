import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockApplyCore } = vi.hoisted(() => ({
  mockApplyCore: vi.fn(),
}))

vi.mock("@/lib/agent/label-feedback-core", () => ({
  applyLabelFeedbackCore: mockApplyCore,
}))

import {
  applyOutlookCategoryFeedback,
  type OutlookProjectionSnapshot,
} from "@/lib/agent/outlook-category-feedback"
import type { FlowDeskLabelName } from "@/lib/email-labels"

// Pre-run snapshot of the apply_labels projection job, as runOutlookDeltaSync
// captures it BEFORE work-item sync can rewrite the job during the run.
function settledPriorJob(labels: FlowDeskLabelName[]): OutlookProjectionSnapshot {
  return { settled: true, labels }
}

describe("applyOutlookCategoryFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyCore.mockResolvedValue({ applied: true, kind: "addition" })
  })

  it("diffs added FlowDesk categories against the pre-run settled projection", async () => {
    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Needs Reply", "Handled", "Custom"],
        priorJob: settledPriorJob(["Needs Reply"]),
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

  it("diffs removed FlowDesk categories against the pre-run settled projection", async () => {
    await applyOutlookCategoryFeedback({
      tenantId: "t1",
      conversationId: "c1",
      messageCategories: ["Custom"],
      priorJob: settledPriorJob(["Needs Reply"]),
    })

    expect(mockApplyCore).toHaveBeenCalledWith(
      expect.objectContaining({ added: [], removed: ["Needs Reply"] })
    )
  })

  it("does not run while the pre-run projection job was still pending or processing", async () => {
    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Custom"],
        priorJob: { settled: false, labels: ["Needs Reply"] },
      })
    ).resolves.toEqual({ applied: false })
    expect(mockApplyCore).not.toHaveBeenCalled()
  })

  it("does not run when FlowDesk never projected labels for the thread", async () => {
    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Needs Reply"],
        priorJob: null,
      })
    ).resolves.toEqual({ applied: false })
    expect(mockApplyCore).not.toHaveBeenCalled()
  })

  it("does not run when the mailbox categories already match the pre-run projection", async () => {
    await expect(
      applyOutlookCategoryFeedback({
        tenantId: "t1",
        conversationId: "c1",
        messageCategories: ["Needs Reply", "Custom"],
        priorJob: settledPriorJob(["Needs Reply"]),
      })
    ).resolves.toEqual({ applied: false })
    expect(mockApplyCore).not.toHaveBeenCalled()
  })
})
