import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationRun: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
    inboxTask: { create: vi.fn(), deleteMany: vi.fn() },
    draft: { update: vi.fn() },
    conversationState: { updateMany: vi.fn(), findFirst: vi.fn() },
    approvalRequest: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { executeAutomationStep, rollbackAutomationStep, type AutomationStep } from "@/lib/agent/automation-runner"
import { prisma } from "@/lib/prisma"

describe("executeAutomationStep", () => {
  it("executes create_task step and returns rollback data", async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValueOnce({ id: "c1", status: "needs_reply" } as never)
    vi.mocked(prisma.inboxTask.create).mockResolvedValueOnce({ id: "task1" } as never)
    const step: AutomationStep = {
      type: "create_task",
      payload: { tenantId: "t1", conversationId: "c1", title: "Follow up", deterministicKey: "auto-c1-follow" },
    }
    const result = await executeAutomationStep(step, "t1")
    expect(result.status).toBe("completed")
    expect(result.rollbackData).toEqual({ taskId: "task1" })
  })

  it("executes update_attention step", async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValueOnce({ id: "c1", status: "needs_reply" } as never)
    vi.mocked(prisma.conversationState.updateMany).mockResolvedValueOnce({ count: 1 } as never)
    const step: AutomationStep = {
      type: "update_attention",
      payload: { conversationId: "c1", attentionCategory: "review_soon", previousAttention: "needs_reply" },
    }
    const result = await executeAutomationStep(step, "t1")
    expect(result.status).toBe("completed")
    expect(result.rollbackData.previousAttention).toBe("needs_reply")
  })

  // ConversationState.attentionCategory (dedicated column, drives Gmail label
  // projection) and metadataJson.attentionCategory (drives the in-app
  // dashboard) must stay in sync — a prior version of this step only wrote
  // the column, which silently desynced Gmail from the app.
  it("keeps metadataJson.attentionCategory in sync with the dedicated column", async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValueOnce({ id: "c1", status: "needs_reply" } as never)
    vi.mocked(prisma.conversationState.findFirst).mockResolvedValueOnce({
      metadataJson: { attentionCategory: "needs_reply", isSalesLead: true },
    } as never)
    vi.mocked(prisma.conversationState.updateMany).mockResolvedValueOnce({ count: 1 } as never)
    const step: AutomationStep = {
      type: "update_attention",
      payload: { conversationId: "c1", attentionCategory: "review_soon", previousAttention: "needs_reply" },
    }
    await executeAutomationStep(step, "t1")

    const calls = vi.mocked(prisma.conversationState.updateMany).mock.calls
    const updateArg = calls[calls.length - 1][0]
    expect(updateArg.data.attentionCategory).toBe("review_soon")
    expect(updateArg.data.metadataJson).toMatchObject({ attentionCategory: "review_soon", isSalesLead: true })
  })

  it("rollback also keeps metadataJson.attentionCategory in sync", async () => {
    vi.mocked(prisma.conversationState.findFirst).mockResolvedValueOnce({
      metadataJson: { attentionCategory: "review_soon" },
    } as never)
    vi.mocked(prisma.conversationState.updateMany).mockResolvedValueOnce({ count: 1 } as never)
    const step: AutomationStep & { rollbackData: Record<string, unknown> } = {
      type: "update_attention",
      payload: {},
      rollbackData: { conversationId: "c1", previousAttention: "needs_reply" },
    }
    await rollbackAutomationStep(step, "t1")

    const calls = vi.mocked(prisma.conversationState.updateMany).mock.calls
    const updateArg = calls[calls.length - 1][0]
    expect(updateArg.data.attentionCategory).toBe("needs_reply")
    expect(updateArg.data.metadataJson).toMatchObject({ attentionCategory: "needs_reply" })
  })

  it("does not mutate automation payload conversations outside the tenant", async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValueOnce(null)
    const step: AutomationStep = {
      type: "archive",
      payload: { conversationId: "other-tenant-conversation" },
    }

    const result = await executeAutomationStep(step, "tenant-1")

    expect(result.status).toBe("failed")
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled()
  })
})
