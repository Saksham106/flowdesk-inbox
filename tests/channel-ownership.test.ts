import { describe, expect, it } from "vitest"

import { canReconnectChannel } from "@/lib/channel-ownership"

describe("canReconnectChannel", () => {
  it("allows reconnecting an account already owned by the tenant", () => {
    expect(canReconnectChannel("tenant-a", "tenant-a")).toBe(true)
  })

  it("rejects moving an account from another tenant", () => {
    expect(canReconnectChannel("tenant-b", "tenant-a")).toBe(false)
  })
})
