import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  credentialFindUnique: vi.fn(),
  eventCreateMany: vi.fn(),
  decrypt: vi.fn((value: string) => value.replace("enc:", "")),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    outlookCredential: { findUnique: mocks.credentialFindUnique },
    outlookSyncEvent: { createMany: mocks.eventCreateMany },
  },
}))

vi.mock("@/lib/crypto", () => ({ decryptString: mocks.decrypt }))

import { POST } from "@/app/api/connectors/outlook/webhook/route"

const notification = {
  id: "notification-1",
  subscriptionId: "subscription-1",
  clientState: "expected-state",
  changeType: "updated",
  resource: "Users/user/messages/message-1",
}

describe("Outlook webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credentialFindUnique.mockResolvedValue({
      channelId: "channel-1",
      subscriptionClientStateEncrypted: "enc:expected-state",
      channel: { tenantId: "tenant-1" },
    })
    mocks.eventCreateMany.mockResolvedValue({ count: 1 })
  })

  it("echoes Microsoft's validation token as plain text", async () => {
    const response = await POST(new Request(
      "https://flowdesk.example/api/connectors/outlook/webhook?validationToken=opaque%20token",
      { method: "POST" }
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/plain")
    await expect(response.text()).resolves.toBe("opaque token")
    expect(mocks.eventCreateMany).not.toHaveBeenCalled()
  })

  it("rejects malformed payloads", async () => {
    const response = await POST(requestWithBody({ value: "not-an-array" }))
    expect(response.status).toBe(400)
    expect(mocks.eventCreateMany).not.toHaveBeenCalled()
  })

  it("rejects an unknown subscription without inserting any batch events", async () => {
    mocks.credentialFindUnique.mockResolvedValue(null)
    const response = await POST(requestWithBody({ value: [notification] }))
    expect(response.status).toBe(401)
    expect(mocks.eventCreateMany).not.toHaveBeenCalled()
  })

  it("rejects a clientState mismatch", async () => {
    const response = await POST(requestWithBody({
      value: [{ ...notification, clientState: "wrong-state" }],
    }))
    expect(response.status).toBe(401)
    expect(mocks.eventCreateMany).not.toHaveBeenCalled()
  })

  it("validates the whole batch and durably queues only routing metadata", async () => {
    const response = await POST(requestWithBody({
      value: [notification, { ...notification, id: "notification-2", changeType: "deleted" }],
    }))

    expect(response.status).toBe(202)
    expect(mocks.eventCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          notificationId: "notification-1",
          subscriptionId: "subscription-1",
          tenantId: "tenant-1",
          channelId: "channel-1",
          changeType: "updated",
        }),
        expect.objectContaining({ notificationId: "notification-2", changeType: "deleted" }),
      ],
      skipDuplicates: true,
    })
    const serialized = JSON.stringify(mocks.eventCreateMany.mock.calls[0][0])
    expect(serialized).not.toContain("expected-state")
  })

  it("keeps duplicate delivery idempotent with the database uniqueness constraint", async () => {
    mocks.eventCreateMany.mockResolvedValue({ count: 0 })
    const response = await POST(requestWithBody({ value: [notification] }))
    expect(response.status).toBe(202)
    expect(mocks.eventCreateMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }))
  })
})

function requestWithBody(body: unknown) {
  return new Request("https://flowdesk.example/api/connectors/outlook/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
