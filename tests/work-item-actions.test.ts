import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

// ── Prisma mock ──────────────────────────────────────────────────────────────

const {
  mockTaskFindFirst,
  mockTaskUpdate,
  mockLeadFindFirst,
  mockLeadUpdate,
  mockApprovalFindFirst,
  mockApprovalFindMany,
  mockApprovalUpdate,
  mockApprovalUpdateMany,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockTaskFindFirst: vi.fn(),
  mockTaskUpdate: vi.fn(),
  mockLeadFindFirst: vi.fn(),
  mockLeadUpdate: vi.fn(),
  mockApprovalFindFirst: vi.fn(),
  mockApprovalFindMany: vi.fn(),
  mockApprovalUpdate: vi.fn(),
  mockApprovalUpdateMany: vi.fn(),
  mockAuditCreate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inboxTask: { findFirst: mockTaskFindFirst, update: mockTaskUpdate },
    lead: { findFirst: mockLeadFindFirst, update: mockLeadUpdate },
    approvalRequest: {
      findFirst: mockApprovalFindFirst,
      findMany: mockApprovalFindMany,
      update: mockApprovalUpdate,
      updateMany: mockApprovalUpdateMany,
    },
    auditLog: { create: mockAuditCreate },
  },
}))

// ── Auth mock ────────────────────────────────────────────────────────────────

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

// ── NextResponse mock ────────────────────────────────────────────────────────

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      _body: body,
      status: init?.status ?? 200,
    }),
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request
}

function makeInvalidJsonRequest(): Request {
  return {
    json: () => Promise.reject(new Error("invalid json")),
  } as unknown as Request
}

function params(id: string) {
  return { params: { id } }
}

// ── Task status route ─────────────────────────────────────────────────────────

describe("PATCH /api/tasks/[id]/status", () => {
  let PATCH: (req: Request, ctx: { params: { id: string } }) => Promise<unknown>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/tasks/[id]/status/route")
    PATCH = mod.PATCH
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = (await PATCH(makeRequest({ status: "closed" }), params("t1"))) as { status: number }
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid status", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const res = (await PATCH(makeRequest({ status: "deleted" }), params("t1"))) as { status: number }
    expect(res.status).toBe(400)
  })

  it("returns 404 when task not found", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    mockTaskFindFirst.mockResolvedValue(null)
    const res = (await PATCH(makeRequest({ status: "closed" }), params("t1"))) as { status: number }
    expect(res.status).toBe(404)
  })

  it("closes a task and writes audit log", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const task = { id: "t1", tenantId: "ten-1", conversationId: "c1", status: "open", title: "Pay invoice" }
    mockTaskFindFirst.mockResolvedValue(task)
    mockTaskUpdate.mockResolvedValue({ ...task, status: "closed" })
    mockAuditCreate.mockResolvedValue({})

    const res = (await PATCH(makeRequest({ status: "closed" }), params("t1"))) as { status: number; _body: { ok: boolean } }
    expect(res.status).toBe(200)
    expect(res._body.ok).toBe(true)
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "closed" }) })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "inbox_task.status_changed" }),
      })
    )
  })

  it("reopens a closed task", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const task = { id: "t1", tenantId: "ten-1", conversationId: "c1", status: "closed", title: "Pay invoice" }
    mockTaskFindFirst.mockResolvedValue(task)
    mockTaskUpdate.mockResolvedValue({ ...task, status: "open" })
    mockAuditCreate.mockResolvedValue({})

    const res = (await PATCH(makeRequest({ status: "open" }), params("t1"))) as { status: number; _body: { ok: boolean } }
    expect(res.status).toBe(200)
    expect(res._body.ok).toBe(true)
  })
})

// ── Task due route ───────────────────────────────────────────────────────────

describe("PATCH /api/tasks/[id]/due", () => {
  let PATCH: (req: NextRequest, ctx: { params: { id: string } }) => Promise<unknown>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/tasks/[id]/due/route")
    PATCH = mod.PATCH
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = (await PATCH(makeRequest({ dueAt: "2026-06-12" }) as NextRequest, params("t1"))) as { status: number }
    expect(res.status).toBe(401)
  })

  it("returns 400 for malformed json", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const res = (await PATCH(makeInvalidJsonRequest() as NextRequest, params("t1"))) as { status: number }
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid due date", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const res = (await PATCH(makeRequest({ dueAt: "not-a-date" }) as NextRequest, params("t1"))) as { status: number }
    expect(res.status).toBe(400)
  })

  it("returns 404 when task not found", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    mockTaskFindFirst.mockResolvedValue(null)
    const res = (await PATCH(makeRequest({ dueAt: "2026-06-12" }) as NextRequest, params("t1"))) as { status: number }
    expect(res.status).toBe(404)
  })

  it("updates a tenant-owned task due date", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const task = { id: "t1", tenantId: "ten-1", conversationId: "c1" }
    mockTaskFindFirst.mockResolvedValue(task)
    mockTaskUpdate.mockResolvedValue({ ...task, dueAt: new Date("2026-06-12T00:00:00.000Z") })
    mockAuditCreate.mockResolvedValue({})

    const res = (await PATCH(makeRequest({ dueAt: "2026-06-12" }) as NextRequest, params("t1"))) as { status: number }
    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: { dueAt: expect.any(Date) },
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "inbox_task.due_date_updated" }),
      })
    )
  })
})

// ── Lead stage route ─────────────────────────────────────────────────────────

describe("PATCH /api/leads/[id]/stage", () => {
  let PATCH: (req: Request, ctx: { params: { id: string } }) => Promise<unknown>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/leads/[id]/stage/route")
    PATCH = mod.PATCH
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = (await PATCH(makeRequest({ stage: "contacted" }), params("l1"))) as { status: number }
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid stage", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const res = (await PATCH(makeRequest({ stage: "maybe" }), params("l1"))) as { status: number }
    expect(res.status).toBe(400)
  })

  it("returns 404 when lead not found", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    mockLeadFindFirst.mockResolvedValue(null)
    const res = (await PATCH(makeRequest({ stage: "contacted" }), params("l1"))) as { status: number }
    expect(res.status).toBe(404)
  })

  it("updates lead stage and writes audit log", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const lead = { id: "l1", tenantId: "ten-1", conversationId: "c1", stage: "new", name: "ABC Dental" }
    mockLeadFindFirst.mockResolvedValue(lead)
    mockLeadUpdate.mockResolvedValue({ ...lead, stage: "contacted" })
    mockAuditCreate.mockResolvedValue({})

    const res = (await PATCH(makeRequest({ stage: "contacted" }), params("l1"))) as { status: number; _body: { ok: boolean } }
    expect(res.status).toBe(200)
    expect(res._body.ok).toBe(true)
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: "contacted" }) })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "lead.stage_changed" }),
      })
    )
  })

  it("optionally updates nextAction", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const lead = { id: "l1", tenantId: "ten-1", conversationId: "c1", stage: "new", name: "ABC Dental" }
    mockLeadFindFirst.mockResolvedValue(lead)
    mockLeadUpdate.mockResolvedValue({ ...lead, stage: "qualified", nextAction: "Send proposal" })
    mockAuditCreate.mockResolvedValue({})

    await PATCH(makeRequest({ stage: "qualified", nextAction: "Send proposal" }), params("l1"))
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: "qualified", nextAction: "Send proposal" }),
      })
    )
  })
})

// ── Approval decide route ─────────────────────────────────────────────────────

describe("POST /api/approvals/[id]/decide", () => {
  let POST: (req: Request, ctx: { params: { id: string } }) => Promise<unknown>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/approvals/[id]/decide/route")
    POST = mod.POST
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = (await POST(makeRequest({ decision: "approved" }), params("a1"))) as { status: number }
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid decision", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const res = (await POST(makeRequest({ decision: "maybe" }), params("a1"))) as { status: number }
    expect(res.status).toBe(400)
  })

  it("returns 404 when pending approval not found", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    mockApprovalFindFirst.mockResolvedValue(null)
    const res = (await POST(makeRequest({ decision: "approved" }), params("a1"))) as { status: number }
    expect(res.status).toBe(404)
  })

  it("approves an approval request and writes audit log", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const approval = { id: "a1", tenantId: "ten-1", conversationId: "c1", status: "pending" }
    mockApprovalFindFirst.mockResolvedValue(approval)
    mockApprovalUpdate.mockResolvedValue({ ...approval, status: "approved" })
    mockAuditCreate.mockResolvedValue({})

    const res = (await POST(makeRequest({ decision: "approved" }), params("a1"))) as { status: number; _body: { ok: boolean } }
    expect(res.status).toBe(200)
    expect(res._body.ok).toBe(true)
    expect(mockApprovalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "approved" }) })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "approval_request.decided" }),
      })
    )
  })

  it("rejects an approval request with a note", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const approval = { id: "a1", tenantId: "ten-1", conversationId: "c1", status: "pending" }
    mockApprovalFindFirst.mockResolvedValue(approval)
    mockApprovalUpdate.mockResolvedValue({ ...approval, status: "rejected" })
    mockAuditCreate.mockResolvedValue({})

    await POST(makeRequest({ decision: "rejected", note: "Too informal" }), params("a1"))
    expect(mockApprovalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "rejected", decisionNote: "Too informal" }),
      })
    )
  })
})

// ── Approval bulk route ──────────────────────────────────────────────────────

describe("POST /api/approvals/bulk", () => {
  let POST: (req: NextRequest) => Promise<unknown>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/approvals/bulk/route")
    POST = mod.POST
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = (await POST(makeRequest({ ids: ["a1"], decision: "approved" }) as NextRequest)) as { status: number }
    expect(res.status).toBe(401)
  })

  it("returns 400 for malformed json", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const res = (await POST(makeInvalidJsonRequest() as NextRequest)) as { status: number }
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid decision", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const res = (await POST(makeRequest({ ids: ["a1"], decision: "maybe" }) as NextRequest)) as { status: number }
    expect(res.status).toBe(400)
  })

  it("returns 400 when no ids are provided", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    const res = (await POST(makeRequest({ ids: [], decision: "approved" }) as NextRequest)) as { status: number }
    expect(res.status).toBe(400)
  })

  it("updates only owned pending approvals", async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "ten-1", id: "u1" } })
    mockApprovalFindMany.mockResolvedValue([{ id: "a1" }])
    mockApprovalUpdateMany.mockResolvedValue({ count: 1 })
    mockAuditCreate.mockResolvedValue({})

    const res = (await POST(makeRequest({ ids: ["a1", "other-tenant"], decision: "approved" }) as NextRequest)) as {
      status: number
      _body: { updated: number }
    }

    expect(res.status).toBe(200)
    expect(res._body.updated).toBe(1)
    expect(mockApprovalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["a1", "other-tenant"] },
          tenantId: "ten-1",
          status: "pending",
        }),
      })
    )
    expect(mockApprovalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["a1"] } },
        data: expect.objectContaining({ status: "approved" }),
      })
    )
  })
})
