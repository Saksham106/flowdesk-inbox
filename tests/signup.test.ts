import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockTenantCreate,
  mockUserCreate,
  mockAutopilotCreate,
  mockFollowUpCreate,
} = vi.hoisted(() => ({
  mockTenantCreate: vi.fn(),
  mockUserCreate: vi.fn(),
  mockAutopilotCreate: vi.fn(),
  mockFollowUpCreate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        tenant: { create: mockTenantCreate },
        user: { create: mockUserCreate },
        autopilotSetting: { create: mockAutopilotCreate },
        followUpSetting: { create: mockFollowUpCreate },
      }),
  },
}))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed") },
}))

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      _body: body,
      status: init?.status ?? 200,
    }),
  },
}))

import { POST } from "@/app/api/auth/signup/route"
import { AUTOMATION_LEVEL_DEFAULT } from "@/lib/agent/automation-level"

function makeRequest(body: unknown): Request {
  return { json: () => Promise.resolve(body) } as unknown as Request
}

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTenantCreate.mockResolvedValue({ id: "tenant-1", salesCrmEnabled: false })
    mockUserCreate.mockResolvedValue({ id: "user-1" })
    mockAutopilotCreate.mockResolvedValue({})
    mockFollowUpCreate.mockResolvedValue({})
  })

  it("creates the AutopilotSetting row at the default automation level (2)", async () => {
    // Pins the trust-ladder default at signup: a tenant MISSING this row is
    // treated as legacy Level 3 by getAutomationLevel, so if signup ever stops
    // creating the row (or creates it at another level), new tenants would
    // silently escalate from "labels only" to "Gmail drafts".
    const res = (await POST(
      makeRequest({ email: "new@example.com", password: "password123" })
    )) as { status: number }

    expect(res.status).toBe(201)
    expect(AUTOMATION_LEVEL_DEFAULT).toBe(2)
    expect(mockAutopilotCreate).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        enabled: false,
        automationLevel: AUTOMATION_LEVEL_DEFAULT,
      },
    })
  })
})
