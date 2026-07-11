import { beforeEach, describe, expect, it, vi } from "vitest"

const graphGet = vi.fn()
const graphRequest = vi.fn()
vi.mock("@/lib/microsoft", () => ({
  getOutlookAccessToken: vi.fn().mockResolvedValue("token"),
  graphGet: (...args: unknown[]) => graphGet(...args),
  graphRequest: (...args: unknown[]) => graphRequest(...args),
  MicrosoftGraphError: class MicrosoftGraphError extends Error {
    constructor(public readonly status: number, public readonly code?: string) { super(`graph ${status}`) }
  },
}))

import {
  applyFlowDeskCategoriesToConversation,
  archiveOutlookConversation,
  createOutlookDraftReply,
  deleteOutlookDraft,
  ensureFlowDeskCategories,
  markOutlookConversationRead,
} from "@/lib/outlook-mailbox"

beforeEach(() => { graphGet.mockReset(); graphRequest.mockReset() })

describe("ensureFlowDeskCategories", () => {
  it("creates only missing categories with preset colors", async () => {
    graphGet.mockResolvedValueOnce({ value: [{ id: "1", displayName: "Needs Reply", color: "preset0" }] })
    graphRequest.mockResolvedValue({})
    await ensureFlowDeskCategories("ch1")
    const created = graphRequest.mock.calls.map(([, , opts]) => (opts as { body: { displayName: string } }).body.displayName)
    expect(created).toHaveLength(9) // 10 canonical minus the 1 existing
    expect(created).not.toContain("Needs Reply")
  })
  it("ignores 409 conflicts from concurrent creation", async () => {
    graphGet.mockResolvedValueOnce({ value: [] })
    const { MicrosoftGraphError } = await import("@/lib/microsoft")
    graphRequest.mockRejectedValue(new MicrosoftGraphError(409))
    await expect(ensureFlowDeskCategories("ch1")).resolves.toBeUndefined()
  })
})

describe("applyFlowDeskCategoriesToConversation", () => {
  it("patches each message, replacing FlowDesk categories but preserving user categories", async () => {
    graphGet
      .mockResolvedValueOnce({ value: [] }) // ensure: master categories
      .mockResolvedValueOnce({ value: [
        { id: "m1", categories: ["Handled", "My Custom"] },
        { id: "m2", categories: [] },
      ] })
    graphRequest.mockResolvedValue({})
    await applyFlowDeskCategoriesToConversation("ch1", "conv-abc", ["Needs Reply"])
    const patches = graphRequest.mock.calls.filter(([path]) => String(path).includes("/messages/"))
    expect(patches).toHaveLength(2)
    const m1 = patches.find(([path]) => String(path).includes("m1"))![2] as { body: { categories: string[] } }
    expect(m1.body.categories.sort()).toEqual(["My Custom", "Needs Reply"])
  })
  it("empty label set strips FlowDesk categories only", async () => {
    graphGet
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: [{ id: "m1", categories: ["Handled", "Keep Me"] }] })
    graphRequest.mockResolvedValue({})
    await applyFlowDeskCategoriesToConversation("ch1", "conv-abc", [])
    const [, , opts] = graphRequest.mock.calls.find(([path]) => String(path).includes("m1"))!
    expect((opts as { body: { categories: string[] } }).body.categories).toEqual(["Keep Me"])
  })
  it("skips PATCH when a message already has exactly the desired categories", async () => {
    graphGet
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: [{ id: "m1", categories: ["Needs Reply"] }] })
    await applyFlowDeskCategoriesToConversation("ch1", "conv-abc", ["Needs Reply"])
    expect(graphRequest.mock.calls.filter(([p]) => String(p).includes("/messages/"))).toHaveLength(0)
  })
})

describe("mark read / archive / drafts", () => {
  it("markOutlookConversationRead strips outlook_ prefix and PATCHes isRead", async () => {
    graphRequest.mockResolvedValue({})
    await markOutlookConversationRead("ch1", ["outlook_abc", "outlook_def"])
    expect(graphRequest).toHaveBeenCalledWith("/me/messages/abc", "token",
      expect.objectContaining({ method: "PATCH", body: { isRead: true } }))
  })
  it("archiveOutlookConversation moves each inbox message to the archive folder", async () => {
    graphGet.mockResolvedValueOnce({ value: [{ id: "m1" }, { id: "m2" }] })
    graphRequest.mockResolvedValue({ id: "moved" })
    await archiveOutlookConversation("ch1", "conv-abc")
    expect(graphRequest).toHaveBeenCalledWith("/me/messages/m1/move", "token",
      expect.objectContaining({ method: "POST", body: { destinationId: "archive" } }))
  })
  it("createOutlookDraftReply creates a reply draft then patches the body", async () => {
    graphGet.mockResolvedValueOnce({ value: [{ id: "last1" }] })
    graphRequest
      .mockResolvedValueOnce({ id: "draft1" }) // createReply
      .mockResolvedValueOnce({})               // body PATCH
    const id = await createOutlookDraftReply("ch1", { externalThreadId: "conv-abc", body: "hello" })
    expect(id).toBe("draft1")
    expect(graphRequest).toHaveBeenNthCalledWith(1, "/me/messages/last1/createReply", "token",
      expect.objectContaining({ method: "POST" }))
  })
  it("deleteOutlookDraft swallows 404", async () => {
    const { MicrosoftGraphError } = await import("@/lib/microsoft")
    graphRequest.mockRejectedValueOnce(new MicrosoftGraphError(404))
    await expect(deleteOutlookDraft("ch1", "gone")).resolves.toBeUndefined()
  })
})
