import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findMany: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/google", () => ({ archiveGmailThread: vi.fn() }))

import { buildBatchToken, parseBatchToken } from "@/lib/clean-inbox-token"

describe("batchToken", () => {
  it("encodes and decodes conversation IDs", () => {
    const ids = ["conv1", "conv2", "conv3"]
    const token = buildBatchToken(ids)
    expect(parseBatchToken(token)).toEqual(ids)
  })

  it("returns empty array for invalid token", () => {
    expect(parseBatchToken("not-valid-base64url!!!")).toEqual([])
  })

  it("handles empty array", () => {
    const ids: string[] = []
    const token = buildBatchToken(ids)
    expect(parseBatchToken(token)).toEqual([])
  })
})

describe("Clean Inbox batch routes", () => {
  it("records previous statuses for undo and revalidates inbox caches", () => {
    const archiveSource = readFileSync(
      join(process.cwd(), "app/api/clean-inbox/archive-batch/route.ts"),
      "utf8"
    )
    const undoSource = readFileSync(
      join(process.cwd(), "app/api/clean-inbox/undo/[batchToken]/route.ts"),
      "utf8"
    )

    expect(archiveSource).toContain("previousStatuses")
    expect(archiveSource).toContain("conversationState.upsert")
    expect(archiveSource).toContain("revalidateInboxViews")
    expect(undoSource).toContain("previousStatuses")
    expect(undoSource).toContain("Restored from Clean Inbox undo")
    expect(undoSource).toContain("revalidateInboxViews")
  })
})
