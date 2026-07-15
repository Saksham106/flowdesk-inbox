import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockQueueFindUnique,
  mockQueueUpsert,
  mockAuditCreate,
  mockProcessJobById,
} = vi.hoisted(() => ({
  mockQueueFindUnique: vi.fn(),
  mockQueueUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockProcessJobById: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailWritebackQueue: { findUnique: mockQueueFindUnique, upsert: mockQueueUpsert },
    auditLog: { create: mockAuditCreate },
    gmailLabelMapping: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock("@/lib/agent/email-writeback-processor", () => ({
  processEmailWritebackJobById: mockProcessJobById,
}))

import { queueFlowDeskLabelWriteback } from "@/lib/email-labels"

const INPUT = {
  tenantId: "tenant-1",
  channelId: "channel-1",
  conversationId: "conv-1",
  threadId: "thread-1",
  labels: ["Needs Reply"] as ["Needs Reply"],
  reason: "classification.draft_ready",
  provider: "google",
}

function existingRow(overrides: Partial<{
  status: string
  labels: string[]
  threadId: string
  updatedAt: Date
}> = {}) {
  return {
    id: "job-1",
    status: overrides.status ?? "completed",
    providerMessageIdsJson: {
      threadId: overrides.threadId ?? "thread-1",
      labels: overrides.labels ?? ["Needs Reply"],
    },
    updatedAt: overrides.updatedAt ?? new Date(),
  }
}

describe("queueFlowDeskLabelWriteback echo-loop idempotence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueueFindUnique.mockResolvedValue(null)
    mockQueueUpsert.mockResolvedValue({ id: "job-1" })
    mockAuditCreate.mockResolvedValue({})
    mockProcessJobById.mockResolvedValue({ ok: true })
  })

  it("skips re-queueing when the last completed writeback applied identical labels", async () => {
    // This is the echo-loop breaker: our own label writeback comes back via
    // push/sync, projection recomputes the same labels, and re-queueing here
    // would mutate the mailbox again — forever.
    mockQueueFindUnique.mockResolvedValue(existingRow({ status: "completed" }))

    const job = await queueFlowDeskLabelWriteback(INPUT)

    expect(job).toBeNull()
    expect(mockQueueUpsert).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalled()
    expect(mockProcessJobById).not.toHaveBeenCalled()
  })

  it("skips re-queueing when the identical writeback was already acknowledged", async () => {
    mockQueueFindUnique.mockResolvedValue(existingRow({ status: "acknowledged" }))

    const job = await queueFlowDeskLabelWriteback(INPUT)

    expect(job).toBeNull()
    expect(mockQueueUpsert).not.toHaveBeenCalled()
  })

  it("returns the pending row untouched when identical labels are already queued", async () => {
    // Resetting attempts/nextAttemptAt on an already-pending identical job
    // would defeat retry backoff; leave the row alone.
    const pending = existingRow({ status: "pending" })
    mockQueueFindUnique.mockResolvedValue(pending)

    const job = await queueFlowDeskLabelWriteback(INPUT)

    expect(job).toBe(pending)
    expect(mockQueueUpsert).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalled()
    expect(mockProcessJobById).not.toHaveBeenCalled()
  })

  it("re-queues when the projected labels differ from the last writeback", async () => {
    mockQueueFindUnique.mockResolvedValue(existingRow({ labels: ["Waiting On"] }))

    const job = await queueFlowDeskLabelWriteback(INPUT)

    expect(job).toEqual({ id: "job-1" })
    expect(mockQueueUpsert).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledTimes(1)
    expect(mockProcessJobById).toHaveBeenCalledWith("job-1")
  })

  it("re-queues an identical set once the completed row is stale, so reconcile can fix drift", async () => {
    mockQueueFindUnique.mockResolvedValue(
      existingRow({ updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
    )

    const job = await queueFlowDeskLabelWriteback(INPUT)

    expect(job).toEqual({ id: "job-1" })
    expect(mockQueueUpsert).toHaveBeenCalledTimes(1)
  })

  it("re-queues when the thread id changed even if labels match", async () => {
    mockQueueFindUnique.mockResolvedValue(existingRow({ threadId: "other-thread" }))

    const job = await queueFlowDeskLabelWriteback(INPUT)

    expect(job).toEqual({ id: "job-1" })
    expect(mockQueueUpsert).toHaveBeenCalledTimes(1)
  })

  it("still skips the empty-set removal for threads FlowDesk never labeled", async () => {
    mockQueueFindUnique.mockResolvedValue(null)

    const job = await queueFlowDeskLabelWriteback({ ...INPUT, labels: [] as never[] })

    expect(job).toBeNull()
    expect(mockQueueUpsert).not.toHaveBeenCalled()
  })

  it("queues the empty-set removal when a prior labeled writeback exists", async () => {
    mockQueueFindUnique.mockResolvedValue(existingRow({ labels: ["Needs Reply"] }))

    const job = await queueFlowDeskLabelWriteback({ ...INPUT, labels: [] as never[] })

    expect(job).toEqual({ id: "job-1" })
    expect(mockQueueUpsert).toHaveBeenCalledTimes(1)
  })

  it("records the superseded label set as payload history when re-queueing", async () => {
    // The history is what lets applyLabelFeedbackCore recognize the mailbox
    // echo of an application this upsert just replaced (rapid classification →
    // draft-gate retag sequences) instead of misreading it as a user edit.
    const supersededAt = new Date(Date.now() - 10_000)
    mockQueueFindUnique.mockResolvedValue(
      existingRow({ labels: ["Read Later", "Notification"], updatedAt: supersededAt })
    )

    await queueFlowDeskLabelWriteback(INPUT)

    const upsertArg = mockQueueUpsert.mock.calls[0][0]
    expect(upsertArg.update.providerMessageIdsJson).toEqual(
      expect.objectContaining({
        labels: ["Needs Reply"],
        history: [{ labels: ["Read Later", "Notification"], at: supersededAt.toISOString() }],
      })
    )
  })

  it("prunes history entries older than the echo window", async () => {
    const recentAt = new Date(Date.now() - 10_000)
    const row = existingRow({ labels: ["Read Later"], updatedAt: recentAt })
    ;(row.providerMessageIdsJson as Record<string, unknown>).history = [
      { labels: ["Handled"], at: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
    ]
    mockQueueFindUnique.mockResolvedValue(row)

    await queueFlowDeskLabelWriteback(INPUT)

    const upsertArg = mockQueueUpsert.mock.calls[0][0]
    expect(upsertArg.update.providerMessageIdsJson.history).toEqual([
      { labels: ["Read Later"], at: recentAt.toISOString() },
    ])
  })
})
