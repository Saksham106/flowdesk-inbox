import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockJobFindMany,
  mockJobUpdateMany,
  mockJobUpdate,
  mockAuditCreate,
  mockRunAgentJob,
} = vi.hoisted(() => ({
  mockJobFindMany: vi.fn(),
  mockJobUpdateMany: vi.fn(),
  mockJobUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockRunAgentJob: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentJob: {
      findMany: mockJobFindMany,
      updateMany: mockJobUpdateMany,
      update: mockJobUpdate,
    },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock("@/lib/agent/jobs", () => ({ runAgentJob: mockRunAgentJob }))

import { processAgentJobWork, STALE_JOB_ERROR } from "@/lib/agent/job-executor"

type FindManyArgs = {
  distinct?: string[]
  take?: number
  where: { status: string; tenantId?: string; createdAt?: { lt?: Date; gte?: Date } }
}

type UpdateManyArgs = {
  where: { id?: string | { in: string[] }; status: string }
  data?: Record<string, unknown>
}

// Routes the three findMany shapes the executor issues: the stale sweep
// (createdAt.lt), the distinct-tenant list, and the per-tenant job pull.
function setupQueues(input: {
  stale?: Array<{ id: string; tenantId: string }>
  pendingByTenant?: Record<string, string[]>
}) {
  const pendingByTenant = input.pendingByTenant ?? {}
  mockJobFindMany.mockImplementation(async (args: FindManyArgs) => {
    if (args.where.createdAt?.lt) return input.stale ?? []
    if (args.distinct) {
      return Object.keys(pendingByTenant).map((tenantId) => ({ tenantId }))
    }
    const tenantJobs = pendingByTenant[args.where.tenantId ?? ""] ?? []
    return tenantJobs.slice(0, args.take).map((id) => ({ id }))
  })
}

function updateManyCalls(): UpdateManyArgs[] {
  return mockJobUpdateMany.mock.calls.map((call) => call[0] as UpdateManyArgs)
}

function claimedIds(): string[] {
  return updateManyCalls()
    .filter((args) => typeof args.where.id === "string")
    .map((args) => args.where.id as string)
}

describe("agent job executor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobUpdateMany.mockImplementation(async (args: UpdateManyArgs) => {
      if (typeof args.where.id === "string") return { count: 1 }
      return { count: args.where.id ? args.where.id.in.length : 0 }
    })
    mockJobUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockRunAgentJob.mockResolvedValue({
      status: "completed",
      intent: "faq",
      confidence: 0.9,
      requiresApproval: false,
    })
  })

  it("claims and runs pending jobs, reporting the summary", async () => {
    setupQueues({ pendingByTenant: { "tenant-1": ["job-1", "job-2"] } })

    const summary = await processAgentJobWork()

    expect(summary).toEqual({ processed: 2, succeeded: 2, failed: 0, skippedStale: 0 })
    expect(mockRunAgentJob).toHaveBeenCalledTimes(2)
    expect(claimedIds()).toEqual(["job-1", "job-2"])
    // Every run is preceded by an atomic pending → running claim
    const claimArgs = updateManyCalls()[0]
    expect(claimArgs.where).toMatchObject({ id: "job-1", status: "pending" })
    expect(claimArgs.data).toMatchObject({ status: "running" })
  })

  it("bounds a single invocation to 25 jobs", async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `job-${i}`)
    setupQueues({ pendingByTenant: { "tenant-1": ids } })

    const summary = await processAgentJobWork()

    expect(summary.processed).toBe(25)
    expect(mockRunAgentJob).toHaveBeenCalledTimes(25)
  })

  it("interleaves tenants round-robin so one backlog cannot starve others", async () => {
    setupQueues({
      pendingByTenant: {
        "tenant-a": Array.from({ length: 40 }, (_, i) => `a-${i}`),
        "tenant-b": ["b-0", "b-1", "b-2"],
      },
    })

    const summary = await processAgentJobWork()

    expect(summary.processed).toBe(25)
    const claimed = claimedIds()
    expect(claimed).toContain("b-0")
    expect(claimed).toContain("b-1")
    expect(claimed).toContain("b-2")
    expect(claimed.slice(0, 6)).toEqual(["a-0", "b-0", "a-1", "b-1", "a-2", "b-2"])
  })

  it("skips jobs another invocation already claimed instead of double-running", async () => {
    setupQueues({ pendingByTenant: { "tenant-1": ["job-1", "job-2"] } })
    mockJobUpdateMany.mockImplementation(async (args: UpdateManyArgs) => {
      if (args.where.id === "job-1") return { count: 0 }
      return { count: 1 }
    })

    const summary = await processAgentJobWork()

    expect(summary.processed).toBe(1)
    expect(mockRunAgentJob).toHaveBeenCalledTimes(1)
    expect(mockRunAgentJob).toHaveBeenCalledWith("job-2")
  })

  it("bulk-fails jobs older than 7 days instead of executing them", async () => {
    setupQueues({
      stale: [
        { id: "old-1", tenantId: "tenant-1" },
        { id: "old-2", tenantId: "tenant-1" },
        { id: "old-3", tenantId: "tenant-2" },
      ],
      pendingByTenant: {},
    })

    const summary = await processAgentJobWork()

    expect(summary).toEqual({ processed: 0, succeeded: 0, failed: 0, skippedStale: 3 })
    expect(mockRunAgentJob).not.toHaveBeenCalled()
    const bulkFail = updateManyCalls().find((args) => typeof args.where.id === "object")
    expect(bulkFail?.where).toMatchObject({
      id: { in: ["old-1", "old-2", "old-3"] },
      status: "pending",
    })
    expect(bulkFail?.data).toMatchObject({ status: "failed", error: STALE_JOB_ERROR })
    expect(mockAuditCreate).toHaveBeenCalledTimes(2)
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        action: "agent_job.stale_bulk_failed",
        payloadJson: { count: 2, error: STALE_JOB_ERROR },
      },
    })
  })

  it("continues the batch when one job throws, persisting the error", async () => {
    setupQueues({ pendingByTenant: { "tenant-1": ["job-1", "job-2", "job-3"] } })
    mockRunAgentJob.mockImplementation(async (jobId: string) => {
      if (jobId === "job-1") throw new Error("db exploded")
      if (jobId === "job-2") return { status: "failed", error: "classify failed" }
      return { status: "completed", intent: "faq", confidence: 0.9, requiresApproval: false }
    })

    const summary = await processAgentJobWork()

    expect(summary).toEqual({ processed: 3, succeeded: 1, failed: 2, skippedStale: 0 })
    expect(mockRunAgentJob).toHaveBeenCalledTimes(3)
    // Thrown (not internally handled) errors are persisted onto the job
    expect(mockJobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "failed", error: "db exploded" }),
    })
  })
})
