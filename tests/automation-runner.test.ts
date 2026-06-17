import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationRun: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    inboxTask: { create: vi.fn(), deleteMany: vi.fn() },
    draft: { update: vi.fn() },
    conversationState: { update: vi.fn() },
    approvalRequest: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { executeAutomationStep, type AutomationStep } from "@/lib/agent/automation-runner"
import { prisma } from "@/lib/prisma"

describe("executeAutomationStep", () => {
  it("executes create_task step and returns rollback data", async () => {
    vi.mocked(prisma.inboxTask.create).mockResolvedValueOnce({ id: "task1" } as never)
    const step: AutomationStep = {
      type: "create_task",
      payload: { tenantId: "t1", conversationId: "c1", title: "Follow up", deterministicKey: "auto-c1-follow" },
    }
    const result = await executeAutomationStep(step)
    expect(result.status).toBe("completed")
    expect(result.rollbackData).toEqual({ taskId: "task1" })
  })

  it("executes update_attention step", async () => {
    vi.mocked(prisma.conversationState.update).mockResolvedValueOnce({} as never)
    const step: AutomationStep = {
      type: "update_attention",
      payload: { conversationId: "c1", attentionCategory: "review_soon", previousAttention: "needs_reply" },
    }
    const result = await executeAutomationStep(step)
    expect(result.status).toBe("completed")
    expect(result.rollbackData.previousAttention).toBe("needs_reply")
  })
})
