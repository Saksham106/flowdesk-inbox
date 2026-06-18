import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationRun: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
    inboxTask: { create: vi.fn(), deleteMany: vi.fn() },
    draft: { update: vi.fn() },
    conversationState: { updateMany: vi.fn() },
    approvalRequest: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { executeAutomationStep, type AutomationStep } from "@/lib/agent/automation-runner"
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
