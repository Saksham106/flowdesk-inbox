import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflowRun: { findMany: vi.fn(), update: vi.fn() },
    conversation: { update: vi.fn() },
    inboxTask: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { advanceWorkflowStep, computeNextRunAt } from "@/lib/agent/workflow-runner"

describe("computeNextRunAt", () => {
  it("returns null for send_draft step (no wait)", () => {
    const step = { type: "send_draft", waitDaysAfterPrevious: 0 }
    expect(computeNextRunAt(step, new Date())).toBeNull()
  })

  it("returns future date for wait step", () => {
    const now = new Date("2026-06-17T10:00:00Z")
    const step = { type: "wait", days: 3 }
    const result = computeNextRunAt(step, now)
    expect(result?.toISOString()).toBe("2026-06-20T10:00:00.000Z")
  })
})
