import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const {
  mockGetServerSession,
  mockCreate,
  mockAuditCreate,
  mockTransaction,
  mockFetch,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockCreate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    knowledgeDocument: { create: mockCreate },
    auditLog: { create: mockAuditCreate },
    $transaction: mockTransaction,
  },
}))

import { POST } from "@/app/api/knowledge-documents/crawl/route"

const SESSION = { user: { tenantId: "t-1", id: "u-1" } }
const CREATED_DOC = { id: "doc-1", title: "FAQ", content: "Some content", sourceType: "webpage" }

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/knowledge-documents/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/knowledge-documents/crawl", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(SESSION)
    mockTransaction.mockResolvedValue([CREATED_DOC])
    vi.stubGlobal("fetch", mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await POST(makeRequest({ url: "https://example.com" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when url is missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("url is required")
  })

  it("returns 400 for invalid URL", async () => {
    const res = await POST(makeRequest({ url: "not-a-url" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Invalid URL")
  })

  it("returns 400 for http:// URL", async () => {
    const res = await POST(makeRequest({ url: "http://example.com" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Only https:// URLs are supported")
  })

  it("returns 400 for localhost URL", async () => {
    const res = await POST(makeRequest({ url: "https://localhost/admin" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Private or loopback URLs are not allowed")
  })

  it("returns 400 for private IP URL", async () => {
    const res = await POST(makeRequest({ url: "https://192.168.1.1/data" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Private or loopback URLs are not allowed")
  })

  it("returns 201 with document on successful crawl", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => "<html><head><title>My FAQ</title></head><body>Some content here that is readable</body></html>",
    })
    const res = await POST(makeRequest({ url: "https://example.com/faq" }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.document).toBeDefined()
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})
